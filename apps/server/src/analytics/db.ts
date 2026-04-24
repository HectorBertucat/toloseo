import { Database } from "bun:sqlite";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { config } from "../config.js";
import { logger } from "../logger.js";

let db: Database | null = null;

export async function initDatabase(): Promise<Database> {
  if (db) return db;

  const dbDir = config.dataDir;
  await mkdir(dbDir, { recursive: true });
  const dbPath = join(dbDir, "analytics.db");

  db = new Database(dbPath);
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA synchronous = NORMAL");
  // 32 MB page cache (was 8 MB) — big enough to help analytics aggregations
  // without competing with the GTFS in-memory store for RAM on a 2 GB VPS.
  db.run("PRAGMA cache_size = -32000");
  db.run("PRAGMA temp_store = MEMORY");

  runMigrations(db);
  logger.info({ path: dbPath }, "analytics database initialized");

  return db;
}

export function getDatabase(): Database {
  if (!db) throw new Error("Database not initialized. Call initDatabase() first.");
  return db;
}

function runMigrations(database: Database): void {
  database.run(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    )
  `);

  const currentVersion = getCurrentVersion(database);

  if (currentVersion < 1) applyMigration1(database);
  if (currentVersion < 2) applyMigration2(database);
  if (currentVersion < 3) applyMigration3(database);
  if (currentVersion < 4) applyMigration4(database);
  // Migration 5 (composite indexes) is opt-in via runDeferredMigrations()
  // because bun:sqlite is synchronous and CREATE INDEX on a large
  // delay_snapshots table blocks the event loop for minutes.
  if (currentVersion < 6) applyMigration6(database);
  if (currentVersion < 7) applyMigration7(database);
}

/**
 * Opt-in, potentially long-running migration for the composite indexes on
 * delay_snapshots. Must be gated by an explicit env var so it only runs
 * during a maintenance window — bun:sqlite's synchronous CREATE INDEX would
 * otherwise stall all HTTP handlers while the index is built.
 */
export async function runDeferredMigrations(): Promise<void> {
  if (!db) return;
  const database = db;
  const currentVersion = getCurrentVersion(database);
  if (currentVersion >= 5) return;

  // Yield once so callers can finish logging / starting other tasks.
  await new Promise((r) => setTimeout(r, 100));

  try {
    applyMigration5(database);
  } catch (err) {
    logger.error({ err }, "deferred migration 5 failed — analytics may be slow");
  }
}

function getCurrentVersion(database: Database): number {
  const row = database
    .query("SELECT MAX(version) as v FROM schema_version")
    .get() as { v: number | null } | null;
  return row?.v ?? 0;
}

function applyMigration1(database: Database): void {
  database.run(`
    CREATE TABLE IF NOT EXISTS delay_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id TEXT NOT NULL,
      vehicle_id TEXT NOT NULL,
      trip_id TEXT NOT NULL,
      delay_seconds INTEGER NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      recorded_at INTEGER NOT NULL,
      service_date TEXT NOT NULL
    )
  `);

  database.run(`
    CREATE INDEX IF NOT EXISTS idx_delay_route_date
    ON delay_snapshots (route_id, service_date)
  `);

  database.run(`
    CREATE INDEX IF NOT EXISTS idx_delay_recorded
    ON delay_snapshots (recorded_at)
  `);

  database.run("INSERT INTO schema_version (version) VALUES (1)");
  logger.info("applied migration 1: delay_snapshots table");
}

function applyMigration2(database: Database): void {
  database.run(`
    CREATE TABLE IF NOT EXISTS calendar_context (
      date TEXT PRIMARY KEY,
      is_holiday INTEGER NOT NULL DEFAULT 0,
      is_school_vacation INTEGER NOT NULL DEFAULT 0,
      vacation_name TEXT,
      holiday_name TEXT
    )
  `);

  database.run("INSERT INTO schema_version (version) VALUES (2)");
  logger.info("applied migration 2: calendar_context table");
}

function applyMigration3(database: Database): void {
  database.run(
    "ALTER TABLE delay_snapshots ADD COLUMN is_realtime INTEGER NOT NULL DEFAULT 0",
  );
  database.run("INSERT INTO schema_version (version) VALUES (3)");
  logger.info("applied migration 3: delay_snapshots.is_realtime");
}

function applyMigration4(database: Database): void {
  database.run(`
    CREATE TABLE IF NOT EXISTS trip_observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recorded_at INTEGER NOT NULL,
      trip_id TEXT NOT NULL,
      route_id TEXT NOT NULL,
      stop_id TEXT NOT NULL,
      stop_sequence INTEGER NOT NULL,
      scheduled_arrival INTEGER,
      predicted_arrival INTEGER,
      delay_seconds INTEGER,
      day_type TEXT NOT NULL,
      hour INTEGER NOT NULL,
      is_vacation INTEGER DEFAULT 0,
      is_holiday INTEGER DEFAULT 0
    )
  `);
  database.run(
    "CREATE INDEX IF NOT EXISTS idx_trip_obs_route_stop ON trip_observations (route_id, stop_id)",
  );
  database.run(
    "CREATE INDEX IF NOT EXISTS idx_trip_obs_time ON trip_observations (recorded_at)",
  );
  database.run("INSERT INTO schema_version (version) VALUES (4)");
  logger.info("applied migration 4: trip_observations table");
}

function applyMigration5(database: Database): void {
  // Composite index for the aggregation queries: WHERE recorded_at >= ?
  // combined with filter/group by route_id or is_realtime. Turns full scans
  // into covering range scans on delay_snapshots (the biggest table).
  database.run(
    "CREATE INDEX IF NOT EXISTS idx_delay_recorded_route ON delay_snapshots (recorded_at, route_id)",
  );
  database.run(
    "CREATE INDEX IF NOT EXISTS idx_delay_recorded_rt ON delay_snapshots (recorded_at, is_realtime)",
  );
  database.run("INSERT INTO schema_version (version) VALUES (5)");
  logger.info("applied migration 5: composite indexes on delay_snapshots");
}

function applyMigration7(database: Database): void {
  // Finer-grained distribution: split early/late into "slightly" and
  // "very" buckets. Uses asymmetric thresholds (-60s / +300s) that match
  // the transit industry standard — a bus 90s early makes passengers miss
  // it, while 90s late is still "on time".
  //
  // Columns added with a default of 0 so existing rows stay consistent.
  // Backfill is triggered explicitly (see runBackfillHourlyStats).
  database.run(
    "ALTER TABLE hourly_stats ADD COLUMN very_early_count INTEGER NOT NULL DEFAULT 0",
  );
  database.run(
    "ALTER TABLE hourly_stats ADD COLUMN very_late_count INTEGER NOT NULL DEFAULT 0",
  );
  database.run("INSERT INTO schema_version (version) VALUES (7)");
  logger.info("applied migration 7: hourly_stats.very_early/very_late_count");
}

function applyMigration6(database: Database): void {
  // Pre-aggregated per-hour statistics. Millions of raw snapshots collapse
  // into ~route_count * hours_retained rows — analytics queries touch a few
  // thousand rows instead of tens of millions. Raw delay_snapshots stay
  // around for short-term detail (30 days), hourly_stats is kept forever.
  database.run(`
    CREATE TABLE IF NOT EXISTS hourly_stats (
      hour_bucket INTEGER NOT NULL,
      route_id TEXT NOT NULL,
      service_date TEXT NOT NULL,
      sample_count INTEGER NOT NULL DEFAULT 0,
      sum_delay INTEGER NOT NULL DEFAULT 0,
      min_delay INTEGER,
      max_delay INTEGER,
      on_time_count INTEGER NOT NULL DEFAULT 0,
      early_count INTEGER NOT NULL DEFAULT 0,
      late_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (hour_bucket, route_id)
    )
  `);
  database.run(
    "CREATE INDEX IF NOT EXISTS idx_hourly_route_bucket ON hourly_stats (route_id, hour_bucket)",
  );
  database.run("INSERT INTO schema_version (version) VALUES (6)");
  logger.info("applied migration 6: hourly_stats table");
}

/**
 * One-shot backfill from delay_snapshots into hourly_stats. Gated via
 * RUN_BACKFILL=1 because on a multi-GB delay_snapshots table this can take
 * several minutes (the aggregate walks every real-time row, grouped by
 * hour and route_id). Writes with INSERT OR REPLACE — idempotent, safe to
 * re-run.
 */
export async function runBackfillHourlyStats(): Promise<void> {
  if (!db) return;
  const database = db;

  logger.info("backfill: starting hourly_stats population from delay_snapshots");
  const started = Date.now();

  // Yield so any startup logging flushes before we burn the main thread.
  await new Promise((r) => setTimeout(r, 100));

  try {
    database.run("BEGIN");
    // Asymmetric on-time band: [-60s, +300s]. Matches the collector's
    // buckets and the transit industry standard.
    database.run(`
      INSERT OR REPLACE INTO hourly_stats
        (hour_bucket, route_id, service_date, sample_count, sum_delay,
         min_delay, max_delay, on_time_count, early_count, late_count,
         very_early_count, very_late_count)
      SELECT
        (recorded_at / 3600) * 3600 AS hour_bucket,
        route_id,
        MAX(service_date) AS service_date,
        COUNT(*) AS sample_count,
        SUM(delay_seconds) AS sum_delay,
        MIN(delay_seconds) AS min_delay,
        MAX(delay_seconds) AS max_delay,
        SUM(CASE WHEN delay_seconds >= -60 AND delay_seconds <= 300 THEN 1 ELSE 0 END) AS on_time_count,
        SUM(CASE WHEN delay_seconds < -60 AND delay_seconds >= -300 THEN 1 ELSE 0 END) AS early_count,
        SUM(CASE WHEN delay_seconds > 300 AND delay_seconds <= 600 THEN 1 ELSE 0 END) AS late_count,
        SUM(CASE WHEN delay_seconds < -300 THEN 1 ELSE 0 END) AS very_early_count,
        SUM(CASE WHEN delay_seconds > 600 THEN 1 ELSE 0 END) AS very_late_count
      FROM delay_snapshots
      WHERE is_realtime = 1 AND delay_seconds >= -900 AND delay_seconds <= 900
      GROUP BY hour_bucket, route_id
    `);
    database.run("COMMIT");

    const count = (database
      .query("SELECT COUNT(*) as n FROM hourly_stats")
      .get() as { n: number }).n;
    logger.info(
      { rows: count, elapsedMs: Date.now() - started },
      "backfill: hourly_stats populated",
    );
  } catch (err) {
    database.run("ROLLBACK");
    logger.error({ err }, "backfill: failed");
  }
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
