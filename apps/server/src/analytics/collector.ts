import { config } from "../config.js";
import { logger } from "../logger.js";
import { getDatabase } from "./db.js";
import {
  getVehicles,
  isGtfsLoaded,
  getVehiclePredictions,
  getStopTimes,
} from "../gtfs/store.js";
import { getCurrentServiceDate, parseGtfsTime } from "../utils/time.js";
import { isHoliday, isSchoolVacation } from "./calendar.js";

let collectorTimer: ReturnType<typeof setInterval> | null = null;

const RETENTION_DAYS = 365;
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
    const predictionsMap = getVehiclePredictions();
    const stopTimesMap = getStopTimes();
    const serviceDate = getCurrentServiceDate();
    const now = Math.floor(Date.now() / 1000);
    const dayType = dayTypeFor(serviceDate);
    const vacation = isSchoolVacation(serviceDate) ? 1 : 0;
    const holiday = isHoliday(serviceDate) ? 1 : 0;

    const snapshotStmt = db.prepare(`
      INSERT INTO delay_snapshots
        (route_id, vehicle_id, trip_id, delay_seconds, lat, lon, recorded_at, service_date, is_realtime)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const obsStmt = db.prepare(`
      INSERT INTO trip_observations
        (recorded_at, trip_id, route_id, stop_id, stop_sequence,
         scheduled_arrival, predicted_arrival, delay_seconds,
         day_type, hour, is_vacation, is_holiday)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let observationsInserted = 0;

    const insertMany = db.transaction(() => {
      for (const v of vehicles.values()) {
        const predictions = predictionsMap.get(v.id) ?? null;
        const isRealtime = predictions && predictions.length > 0 ? 1 : 0;

        snapshotStmt.run(
          v.routeId,
          v.id,
          v.tripId,
          v.delay,
          v.lat,
          v.lon,
          now,
          serviceDate,
          isRealtime,
        );

        const nextStop = predictions
          ? predictions.find((p) => (p.arrival || p.departure) >= now)
          : null;
        if (!nextStop) continue;

        const scheduledArrival = getScheduledArrival(
          stopTimesMap,
          v.tripId,
          nextStop.stopId,
          serviceDate,
        );
        const predicted = nextStop.arrival || nextStop.departure;
        const delay = scheduledArrival ? predicted - scheduledArrival : null;

        obsStmt.run(
          now,
          v.tripId,
          v.routeId,
          nextStop.stopId,
          nextStop.stopSequence,
          scheduledArrival,
          predicted,
          delay,
          dayType,
          new Date(now * 1000).getHours(),
          vacation,
          holiday,
        );
        observationsInserted++;
      }
    });

    insertMany();

    logger.debug(
      { vehicles: vehicles.size, observations: observationsInserted, serviceDate },
      "analytics snapshot collected",
    );
  } catch (err) {
    logger.error({ err }, "analytics snapshot collection failed");
  }
}

function dayTypeFor(serviceDate: string): string {
  if (isHoliday(serviceDate)) return "holiday";
  if (isSchoolVacation(serviceDate)) return "vacation";
  const dow = new Date(`${serviceDate}T00:00:00`).getDay();
  if (dow === 0) return "sunday";
  if (dow === 6) return "saturday";
  return "weekday";
}

function getScheduledArrival(
  stopTimesMap: ReturnType<typeof getStopTimes>,
  tripId: string,
  stopId: string,
  serviceDate: string,
): number | null {
  const times = stopTimesMap.get(tripId);
  if (!times) return null;
  const entry = times.find((t) => t.stopId === stopId);
  if (!entry) return null;
  const ms = parseGtfsTime(entry.arrivalTime || entry.departureTime, serviceDate);
  return Math.floor(ms / 1000);
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
