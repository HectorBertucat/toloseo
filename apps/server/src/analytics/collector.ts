import { config } from "../config.js";
import { logger } from "../logger.js";
import { getDatabase } from "./db.js";
import { getVehicles, isGtfsLoaded } from "../gtfs/store.js";
import { getCurrentServiceDate } from "../utils/time.js";

let collectorTimer: ReturnType<typeof setInterval> | null = null;

const RETENTION_DAYS = 90;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startCollector(): void {
  logger.info(
    { intervalMs: config.analyticsSnapshotIntervalMs },
    "starting analytics collector",
  );
  collectorTimer = setInterval(
    collectSnapshot,
    config.analyticsSnapshotIntervalMs,
  );

  cleanupOldData();
  cleanupTimer = setInterval(cleanupOldData, CLEANUP_INTERVAL_MS);
}

export function stopCollector(): void {
  if (collectorTimer) {
    clearInterval(collectorTimer);
    collectorTimer = null;
  }
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

function collectSnapshot(): void {
  if (!isGtfsLoaded()) return;

  try {
    const vehicles = getVehicles();
    if (vehicles.size === 0) return;

    const db = getDatabase();
    const serviceDate = getCurrentServiceDate();
    const now = Math.floor(Date.now() / 1000);

    const stmt = db.prepare(`
      INSERT INTO delay_snapshots
        (route_id, vehicle_id, trip_id, delay_seconds, lat, lon, recorded_at, service_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction(() => {
      for (const v of vehicles.values()) {
        stmt.run(
          v.routeId,
          v.id,
          v.tripId,
          v.delay,
          v.lat,
          v.lon,
          now,
          serviceDate,
        );
      }
    });

    insertMany();

    logger.debug(
      { vehicles: vehicles.size, serviceDate },
      "analytics snapshot collected",
    );
  } catch (err) {
    logger.error({ err }, "analytics snapshot collection failed");
  }
}

function cleanupOldData(): void {
  try {
    const db = getDatabase();
    const cutoff = Math.floor(Date.now() / 1000) - RETENTION_DAYS * 86400;
    const result = db.run(
      "DELETE FROM delay_snapshots WHERE recorded_at < ?",
      [cutoff],
    );
    if (result.changes > 0) {
      logger.info(
        { deletedRows: result.changes, retentionDays: RETENTION_DAYS },
        "cleaned up old analytics data",
      );
    }
  } catch (err) {
    logger.error({ err }, "analytics cleanup failed");
  }
}
