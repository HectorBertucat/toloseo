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
  db.run("PRAGMA cache_size = -8000");

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

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
