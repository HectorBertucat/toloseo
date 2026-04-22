import { getDatabase } from "./db.js";
import { getVehicles, getRoutes, getAlerts } from "../gtfs/store.js";
import type { DelayByHour, ReliabilityScore, AnalyticsSummary, TrendData } from "@shared/types.js";

const ON_TIME_THRESHOLD_SECONDS = 300;
const SANITY_BOUND_SECONDS = 1800;

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
  const rows = routeId
    ? (db
        .query(
          `SELECT
            CAST(((hour_bucket + ?) / 3600) % 24 AS INTEGER) as hour,
            SUM(sum_delay) * 1.0 / NULLIF(SUM(sample_count), 0) as avg_delay,
            SUM(sample_count) as sample_count
          FROM hourly_stats
          WHERE route_id = ? AND hour_bucket >= ?
          GROUP BY hour
          ORDER BY hour`,
        )
        .all(tzOffset, routeId, cutoff) as {
          hour: number;
          avg_delay: number | null;
          sample_count: number;
        }[])
    : (db
        .query(
          `SELECT
            CAST(((hour_bucket + ?) / 3600) % 24 AS INTEGER) as hour,
            SUM(sum_delay) * 1.0 / NULLIF(SUM(sample_count), 0) as avg_delay,
            SUM(sample_count) as sample_count
          FROM hourly_stats
          WHERE hour_bucket >= ?
          GROUP BY hour
          ORDER BY hour`,
        )
        .all(tzOffset, cutoff) as {
          hour: number;
          avg_delay: number | null;
          sample_count: number;
        }[]);

  return rows.map((row) => ({
    hour: row.hour,
    avgDelay: Math.round(row.avg_delay ?? 0),
    p50Delay: Math.round(row.avg_delay ?? 0),
    p90Delay: 0, // deprecated: the synthetic "* 1.8" was not statistically meaningful
    sampleCount: row.sample_count,
  }));
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
        SUM(on_time_count) as on_time_count
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
  }[];

  return rows.map((row) => ({
    routeId: row.route_id,
    onTimePercent: Math.round((row.on_time_count / row.total_trips) * 100),
    avgDelay: Math.round(row.avg_delay ?? 0),
    maxDelay: row.max_delay ?? 0,
    totalTrips: row.total_trips,
    period: `${days}d`,
  }));
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
      SUM(on_time_count) as on_time_count
    FROM hourly_stats
    WHERE route_id = ? AND hour_bucket >= ?
  `).get(routeId, cutoff) as {
    total_trips: number | null;
    avg_delay: number | null;
    max_delay: number | null;
    on_time_count: number | null;
  } | null;

  if (!row || !row.total_trips || row.total_trips === 0) return null;

  return {
    routeId,
    onTimePercent: Math.round(((row.on_time_count ?? 0) / row.total_trips) * 100),
    avgDelay: Math.round(row.avg_delay ?? 0),
    maxDelay: row.max_delay ?? 0,
    totalTrips: row.total_trips,
    period: `${days}d`,
  };
}

export function queryAnalyticsSummary(): AnalyticsSummary {
  const vehicles = getVehicles();
  const routes = getRoutes();
  const alerts = getAlerts();

  // Only consider vehicles with a real-time signal: a zero delay on a vehicle
  // with no RT data is a "stub" and should not pull the network average.
  let totalDelay = 0;
  let onTimeCount = 0;
  let rtVehicleCount = 0;

  for (const v of vehicles.values()) {
    if (v.delay === 0) continue; // stub / no RT
    if (Math.abs(v.delay) > SANITY_BOUND_SECONDS) continue; // outlier
    rtVehicleCount++;
    totalDelay += v.delay;
    if (Math.abs(v.delay) <= ON_TIME_THRESHOLD_SECONDS) onTimeCount++;
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
