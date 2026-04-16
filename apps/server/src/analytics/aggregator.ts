import { getDatabase } from "./db.js";
import { getVehicles, getRoutes, getAlerts } from "../gtfs/store.js";
import type { DelayByHour, ReliabilityScore, AnalyticsSummary, TrendData } from "@shared/types.js";

const ON_TIME_THRESHOLD_SECONDS = 300;
const SANITY_BOUND_SECONDS = 1800;

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
  const db = getDatabase();
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
  const tzOffset = parisOffsetSeconds();

  const baseWhere = `recorded_at >= ?
    AND is_realtime = 1
    AND ABS(delay_seconds) <= ?`;

  const rows = routeId
    ? (db
        .query(
          `SELECT
            CAST(((recorded_at + ?) % 86400) / 3600 AS INTEGER) as hour,
            AVG(delay_seconds) as avg_delay,
            COUNT(*) as sample_count
          FROM delay_snapshots
          WHERE route_id = ? AND ${baseWhere}
          GROUP BY hour
          ORDER BY hour`,
        )
        .all(tzOffset, routeId, cutoff, SANITY_BOUND_SECONDS) as {
          hour: number;
          avg_delay: number;
          sample_count: number;
        }[])
    : (db
        .query(
          `SELECT
            CAST(((recorded_at + ?) % 86400) / 3600 AS INTEGER) as hour,
            AVG(delay_seconds) as avg_delay,
            COUNT(*) as sample_count
          FROM delay_snapshots
          WHERE ${baseWhere}
          GROUP BY hour
          ORDER BY hour`,
        )
        .all(tzOffset, cutoff, SANITY_BOUND_SECONDS) as {
          hour: number;
          avg_delay: number;
          sample_count: number;
        }[]);

  return rows.map((row) => ({
    hour: row.hour,
    avgDelay: Math.round(row.avg_delay),
    p50Delay: Math.round(row.avg_delay),
    p90Delay: 0, // deprecated: the synthetic "* 1.8" was not statistically meaningful
    sampleCount: row.sample_count,
  }));
}

export function queryAllReliability(days: number): ReliabilityScore[] {
  const db = getDatabase();
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

  const rows = db
    .query(
      `SELECT
        route_id,
        COUNT(*) as total_trips,
        AVG(delay_seconds) as avg_delay,
        MAX(delay_seconds) as max_delay,
        SUM(CASE WHEN ABS(delay_seconds) <= ? THEN 1 ELSE 0 END) as on_time_count
      FROM delay_snapshots
      WHERE recorded_at >= ?
        AND is_realtime = 1
        AND ABS(delay_seconds) <= ?
      GROUP BY route_id
      HAVING COUNT(*) > 30
      ORDER BY on_time_count * 1.0 / total_trips DESC`,
    )
    .all(ON_TIME_THRESHOLD_SECONDS, cutoff, SANITY_BOUND_SECONDS) as {
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
  const db = getDatabase();
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

  const row = db.query(`
    SELECT
      COUNT(*) as total_trips,
      AVG(delay_seconds) as avg_delay,
      MAX(delay_seconds) as max_delay,
      SUM(CASE WHEN ABS(delay_seconds) <= ? THEN 1 ELSE 0 END) as on_time_count
    FROM delay_snapshots
    WHERE route_id = ? AND recorded_at >= ?
      AND is_realtime = 1
      AND ABS(delay_seconds) <= ?
  `).get(ON_TIME_THRESHOLD_SECONDS, routeId, cutoff, SANITY_BOUND_SECONDS) as {
    total_trips: number;
    avg_delay: number | null;
    max_delay: number | null;
    on_time_count: number;
  } | null;

  if (!row || row.total_trips === 0) return null;

  return {
    routeId,
    onTimePercent: Math.round((row.on_time_count / row.total_trips) * 100),
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
  const db = getDatabase();
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

  const rows = db.query(`
    SELECT
      service_date as date,
      AVG(delay_seconds) as avg_delay,
      SUM(CASE WHEN ABS(delay_seconds) <= ? THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as on_time_pct,
      COUNT(DISTINCT vehicle_id) as vehicle_count
    FROM delay_snapshots
    WHERE recorded_at >= ?
      AND is_realtime = 1
      AND ABS(delay_seconds) <= ?
    GROUP BY service_date
    ORDER BY service_date
  `).all(ON_TIME_THRESHOLD_SECONDS, cutoff, SANITY_BOUND_SECONDS) as {
    date: string;
    avg_delay: number;
    on_time_pct: number;
    vehicle_count: number;
  }[];

  return rows.map((row) => ({
    date: row.date,
    avgDelay: Math.round(row.avg_delay),
    onTimePercent: Math.round(row.on_time_pct),
    vehicleCount: row.vehicle_count,
  }));
}
