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

// Raw snapshot retention — short because hourly_stats keeps the summary
// forever. 30 days is enough to troubleshoot a recent incident per-vehicle.
const RETENTION_DAYS = 30;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
// Asymmetric on-time band matching the transit industry convention.
// Early arrivals disrupt passengers (they miss the bus); late arrivals
// within ~5 min are tolerable. A symmetric 5-minute band was the main
// source of the "everything looks early" analytics bug.
const ON_TIME_MIN_S = -60; // anything earlier is "early"
const ON_TIME_MAX_S = 300; // anything later is "late"
const VERY_EARLY_S = -300; // beyond that: very early
const VERY_LATE_S = 600; // beyond that: very late
// Tighter outlier gate — a 30-minute early/late snapshot is almost always
// stale-feed noise that drags the averages off.
const SANITY_BOUND_SECONDS = 900;

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

    // Incrementally fold this tick into hourly_stats. UPSERT adds the new
    // observation to the running totals for (hour_bucket, route_id) so
    // analytics queries can read aggregated data instead of millions of
    // raw rows.
    const hourlyStmt = db.prepare(`
      INSERT INTO hourly_stats
        (hour_bucket, route_id, service_date, sample_count, sum_delay,
         min_delay, max_delay, on_time_count, early_count, late_count,
         very_early_count, very_late_count)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (hour_bucket, route_id) DO UPDATE SET
        sample_count = sample_count + 1,
        sum_delay = sum_delay + excluded.sum_delay,
        min_delay = CASE
          WHEN min_delay IS NULL OR excluded.min_delay < min_delay
          THEN excluded.min_delay ELSE min_delay END,
        max_delay = CASE
          WHEN max_delay IS NULL OR excluded.max_delay > max_delay
          THEN excluded.max_delay ELSE max_delay END,
        on_time_count = on_time_count + excluded.on_time_count,
        early_count = early_count + excluded.early_count,
        late_count = late_count + excluded.late_count,
        very_early_count = very_early_count + excluded.very_early_count,
        very_late_count = very_late_count + excluded.very_late_count
    `);

    const hourBucket = Math.floor(now / 3600) * 3600;

    let observationsInserted = 0;

    const insertMany = db.transaction(() => {
      for (const v of vehicles.values()) {
        const predictions = predictionsMap.get(v.id) ?? null;
        // A vehicle counts as "real-time" for analytics ONLY when its
        // delay came from a TripUpdate (isRealtimeDelay). VehiclePosition
        // stubs carry delay=0 synthetically — counting those as "on time"
        // was the biggest contributor to the early/on-time skew.
        const hasRtDelay = v.isRealtimeDelay === true;
        const isRealtime = hasRtDelay ? 1 : 0;

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

        if (hasRtDelay && v.delay >= -SANITY_BOUND_SECONDS && v.delay <= SANITY_BOUND_SECONDS) {
          const onTime = v.delay >= ON_TIME_MIN_S && v.delay <= ON_TIME_MAX_S ? 1 : 0;
          const early = v.delay < ON_TIME_MIN_S && v.delay >= VERY_EARLY_S ? 1 : 0;
          const late = v.delay > ON_TIME_MAX_S && v.delay <= VERY_LATE_S ? 1 : 0;
          const veryEarly = v.delay < VERY_EARLY_S ? 1 : 0;
          const veryLate = v.delay > VERY_LATE_S ? 1 : 0;
          hourlyStmt.run(
            hourBucket,
            v.routeId,
            serviceDate,
            v.delay,
            v.delay,
            v.delay,
            onTime,
            early,
            late,
            veryEarly,
            veryLate,
          );
        }

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
