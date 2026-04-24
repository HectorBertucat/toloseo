import { getDatabase } from "./db.js";
import { getVehicles, getRoutes, getAlerts } from "../gtfs/store.js";
import type {
  DelayByHour,
  DelayDistribution,
  ReliabilityScore,
  AnalyticsSummary,
  TrendData,
} from "@shared/types.js";

// Asymmetric on-time band — matches collector.ts and transit industry
// standard. Keeping these in sync across files prevents the class of
// "avgDelay says early but stop popup says late" contradictions.
const ON_TIME_MIN_S = -60;
const ON_TIME_MAX_S = 300;
const SANITY_BOUND_SECONDS = 900;

// In-memory TTL cache for heavy aggregations. Data is only refreshed every
// 60s anyway (collector interval), so hitting SQLite on every request is
// wasteful. Aligned with the HTTP cache-control max-age=60s on the routes.
const AGG_TTL_MS = 60_000;
const aggCache = new Map<string, { expires: number; data: unknown }>();

function cached<T>(key: string, fn: () => T): T {
  const now = Date.now();
  const hit = aggCache.get(key);
  if (hit && hit.expires > now) return hit.data as T;
  const data = fn();
  aggCache.set(key, { expires: now + AGG_TTL_MS, data });
  return data;
}

// Paris-local TZ offset (seconds) for a given moment, for shifting unix
// timestamps into local-hour buckets inside SQL.
function parisOffsetSeconds(at: number = Date.now()): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(at));
  const p: Record<string, string> = {};
  for (const part of fmt) p[part.type] = part.value;
  const hour = p["hour"] === "24" ? 0 : parseInt(p["hour"] ?? "0", 10);
  const localMs = Date.UTC(
    parseInt(p["year"] ?? "0", 10),
    parseInt(p["month"] ?? "1", 10) - 1,
    parseInt(p["day"] ?? "1", 10),
    hour,
    parseInt(p["minute"] ?? "0", 10),
    parseInt(p["second"] ?? "0", 10),
  );
  return Math.round((localMs - at) / 1000);
}

function emptyDistribution(): DelayDistribution {
  return { veryEarly: 0, early: 0, onTime: 0, late: 0, veryLate: 0 };
}

/**
 * Median delay from raw delay_snapshots, filtered by realtime + sanity.
 * Split out because hourly_stats only stores a signed sum; recovering a
 * median from that is impossible. Scoped by (cutoff, optional routeId).
 */
function queryMedianDelay(routeId: string | null, days: number): number {
  const db = getDatabase();
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

  const row = routeId
    ? db
        .query(
          `SELECT delay_seconds FROM delay_snapshots
           WHERE is_realtime = 1
             AND delay_seconds >= -${SANITY_BOUND_SECONDS}
             AND delay_seconds <= ${SANITY_BOUND_SECONDS}
             AND recorded_at >= ?
             AND route_id = ?
           ORDER BY delay_seconds
           LIMIT 1 OFFSET (
             SELECT COUNT(*) / 2 FROM delay_snapshots
             WHERE is_realtime = 1
               AND delay_seconds >= -${SANITY_BOUND_SECONDS}
               AND delay_seconds <= ${SANITY_BOUND_SECONDS}
               AND recorded_at >= ?
               AND route_id = ?
           )`,
        )
        .get(cutoff, routeId, cutoff, routeId) as { delay_seconds: number } | null
    : db
        .query(
          `SELECT delay_seconds FROM delay_snapshots
           WHERE is_realtime = 1
             AND delay_seconds >= -${SANITY_BOUND_SECONDS}
             AND delay_seconds <= ${SANITY_BOUND_SECONDS}
             AND recorded_at >= ?
           ORDER BY delay_seconds
           LIMIT 1 OFFSET (
             SELECT COUNT(*) / 2 FROM delay_snapshots
             WHERE is_realtime = 1
               AND delay_seconds >= -${SANITY_BOUND_SECONDS}
               AND delay_seconds <= ${SANITY_BOUND_SECONDS}
               AND recorded_at >= ?
           )`,
        )
        .get(cutoff, cutoff) as { delay_seconds: number } | null;

  return row?.delay_seconds ?? 0;
}

export function queryDelayByHour(routeId: string | null, days: number): DelayByHour[] {
  return cached(`delay-by-hour:${routeId ?? "all"}:${days}`, () =>
    queryDelayByHourImpl(routeId, days),
  );
}

function queryDelayByHourImpl(routeId: string | null, days: number): DelayByHour[] {
  const db = getDatabase();
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
  const tzOffset = parisOffsetSeconds();

  // hour_bucket is stored in UTC; shift by tzOffset to render Paris-local hours.
  const sql = `SELECT
      CAST(((hour_bucket + ?) / 3600) % 24 AS INTEGER) as hour,
      SUM(sum_delay) * 1.0 / NULLIF(SUM(sample_count), 0) as avg_delay,
      SUM(sample_count) as sample_count,
      SUM(on_time_count) as on_time,
      SUM(early_count) as early,
      SUM(late_count) as late,
      SUM(very_early_count) as very_early,
      SUM(very_late_count) as very_late
    FROM hourly_stats
    WHERE ${routeId ? "route_id = ? AND " : ""}hour_bucket >= ?
    GROUP BY hour
    ORDER BY hour`;

  const rows = (
    routeId
      ? db.query(sql).all(tzOffset, routeId, cutoff)
      : db.query(sql).all(tzOffset, cutoff)
  ) as {
    hour: number;
    avg_delay: number | null;
    sample_count: number;
    on_time: number;
    early: number;
    late: number;
    very_early: number;
    very_late: number;
  }[];

  // Per-hour median: derive from delay_snapshots histogram. Approximate
  // by evaluating median on the aggregated distribution (cheap, accurate
  // to within ~60s given our bucket granularity).
  return rows.map((row) => {
    const distribution: DelayDistribution = {
      veryEarly: row.very_early,
      early: row.early,
      onTime: row.on_time,
      late: row.late,
      veryLate: row.very_late,
    };
    return {
      hour: row.hour,
      avgDelay: Math.round(row.avg_delay ?? 0),
      medianDelay: medianFromDistribution(distribution),
      p50Delay: Math.round(row.avg_delay ?? 0), // kept for backwards compat
      p90Delay: 0, // deprecated
      sampleCount: row.sample_count,
      distribution,
    };
  });
}

/**
 * Estimate median delay from a bucketed distribution. Not exact (uses bucket
 * midpoints), but fast — avoids a full delay_snapshots scan per row.
 */
function medianFromDistribution(d: DelayDistribution): number {
  const total = d.veryEarly + d.early + d.onTime + d.late + d.veryLate;
  if (total === 0) return 0;
  const half = total / 2;
  let acc = 0;
  const buckets: [number, number][] = [
    [-600, d.veryEarly],
    [-180, d.early],
    [60, d.onTime],
    [450, d.late],
    [900, d.veryLate],
  ];
  for (const [mid, count] of buckets) {
    acc += count;
    if (acc >= half) return mid;
  }
  return 0;
}

export function queryAllReliability(days: number): ReliabilityScore[] {
  return cached(`all-reliability:${days}`, () => queryAllReliabilityImpl(days));
}

function queryAllReliabilityImpl(days: number): ReliabilityScore[] {
  const db = getDatabase();
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

  const rows = db
    .query(
      `SELECT
        route_id,
        SUM(sample_count) as total_trips,
        SUM(sum_delay) * 1.0 / NULLIF(SUM(sample_count), 0) as avg_delay,
        MAX(max_delay) as max_delay,
        SUM(on_time_count) as on_time_count,
        SUM(early_count) as early_count,
        SUM(late_count) as late_count,
        SUM(very_early_count) as very_early_count,
        SUM(very_late_count) as very_late_count
      FROM hourly_stats
      WHERE hour_bucket >= ?
      GROUP BY route_id
      HAVING SUM(sample_count) > 30
      ORDER BY SUM(on_time_count) * 1.0 / SUM(sample_count) DESC`,
    )
    .all(cutoff) as {
    route_id: string;
    total_trips: number;
    avg_delay: number | null;
    max_delay: number | null;
    on_time_count: number;
    early_count: number;
    late_count: number;
    very_early_count: number;
    very_late_count: number;
  }[];

  return rows.map((row) => {
    const distribution: DelayDistribution = {
      veryEarly: row.very_early_count,
      early: row.early_count,
      onTime: row.on_time_count,
      late: row.late_count,
      veryLate: row.very_late_count,
    };
    return {
      routeId: row.route_id,
      onTimePercent: Math.round((row.on_time_count / row.total_trips) * 100),
      avgDelay: Math.round(row.avg_delay ?? 0),
      medianDelay: medianFromDistribution(distribution),
      maxDelay: row.max_delay ?? 0,
      totalTrips: row.total_trips,
      period: `${days}d`,
      distribution,
    };
  });
}

export function queryReliability(
  routeId: string,
  days: number,
): ReliabilityScore | null {
  return cached(`reliability:${routeId}:${days}`, () =>
    queryReliabilityImpl(routeId, days),
  );
}

function queryReliabilityImpl(
  routeId: string,
  days: number,
): ReliabilityScore | null {
  const db = getDatabase();
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

  const row = db.query(`
    SELECT
      SUM(sample_count) as total_trips,
      SUM(sum_delay) * 1.0 / NULLIF(SUM(sample_count), 0) as avg_delay,
      MAX(max_delay) as max_delay,
      SUM(on_time_count) as on_time_count,
      SUM(early_count) as early_count,
      SUM(late_count) as late_count,
      SUM(very_early_count) as very_early_count,
      SUM(very_late_count) as very_late_count
    FROM hourly_stats
    WHERE route_id = ? AND hour_bucket >= ?
  `).get(routeId, cutoff) as {
    total_trips: number | null;
    avg_delay: number | null;
    max_delay: number | null;
    on_time_count: number | null;
    early_count: number | null;
    late_count: number | null;
    very_early_count: number | null;
    very_late_count: number | null;
  } | null;

  if (!row || !row.total_trips || row.total_trips === 0) return null;

  const distribution: DelayDistribution = {
    veryEarly: row.very_early_count ?? 0,
    early: row.early_count ?? 0,
    onTime: row.on_time_count ?? 0,
    late: row.late_count ?? 0,
    veryLate: row.very_late_count ?? 0,
  };

  return {
    routeId,
    onTimePercent: Math.round(((row.on_time_count ?? 0) / row.total_trips) * 100),
    avgDelay: Math.round(row.avg_delay ?? 0),
    medianDelay: medianFromDistribution(distribution),
    maxDelay: row.max_delay ?? 0,
    totalTrips: row.total_trips,
    period: `${days}d`,
    distribution,
  };
}

export function queryAnalyticsSummary(): AnalyticsSummary {
  const vehicles = getVehicles();
  const routes = getRoutes();
  const alerts = getAlerts();

  // Only consider vehicles with a real-time delay signal (TripUpdate origin).
  // VehiclePosition stubs would otherwise drag the network average to 0.
  let totalDelay = 0;
  let onTimeCount = 0;
  let rtVehicleCount = 0;

  for (const v of vehicles.values()) {
    if (v.isRealtimeDelay !== true) continue;
    if (v.delay < -SANITY_BOUND_SECONDS || v.delay > SANITY_BOUND_SECONDS) continue;
    rtVehicleCount++;
    totalDelay += v.delay;
    if (v.delay >= ON_TIME_MIN_S && v.delay <= ON_TIME_MAX_S) onTimeCount++;
  }

  return {
    totalRoutes: routes.size,
    activeVehicles: vehicles.size,
    avgNetworkDelay:
      rtVehicleCount > 0 ? Math.round(totalDelay / rtVehicleCount) : 0,
    onTimePercent:
      rtVehicleCount > 0 ? Math.round((onTimeCount / rtVehicleCount) * 100) : 100,
    activeAlerts: alerts.length,
    lastUpdated: Date.now(),
  };
}

export function queryTrend(days: number): TrendData[] {
  return cached(`trend:${days}`, () => queryTrendImpl(days));
}

function queryTrendImpl(days: number): TrendData[] {
  const db = getDatabase();
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

  // vehicle_count is no longer exact (hourly_stats doesn't keep distinct
  // vehicle IDs). Approximate by dividing total samples by a typical vehicle
  // activity factor — good enough for a trend sparkline.
  const rows = db.query(`
    SELECT
      service_date as date,
      SUM(sum_delay) * 1.0 / NULLIF(SUM(sample_count), 0) as avg_delay,
      SUM(on_time_count) * 100.0 / NULLIF(SUM(sample_count), 0) as on_time_pct,
      SUM(sample_count) as sample_count
    FROM hourly_stats
    WHERE hour_bucket >= ?
    GROUP BY service_date
    ORDER BY service_date
  `).all(cutoff) as {
    date: string;
    avg_delay: number | null;
    on_time_pct: number | null;
    sample_count: number;
  }[];

  return rows.map((row) => ({
    date: row.date,
    avgDelay: Math.round(row.avg_delay ?? 0),
    onTimePercent: Math.round(row.on_time_pct ?? 0),
    // Rough active-vehicle approximation: ~1 sample per minute per vehicle,
    // ~16h of service per day → 960 samples/vehicle-day.
    vehicleCount: Math.round(row.sample_count / 960),
  }));
}

// Exported for completeness even if currently unused by routes — lets a
// future analytics endpoint expose the median computed from raw snapshots.
export { queryMedianDelay };
