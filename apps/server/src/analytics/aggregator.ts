import { getDatabase } from "./db.js";
import { getVehicles, getRoutes, getAlerts } from "../gtfs/store.js";
import type { DelayByHour, ReliabilityScore, AnalyticsSummary, TrendData } from "@shared/types.js";

const ON_TIME_THRESHOLD_SECONDS = 300;

export function queryDelayByHour(routeId: string | null, days: number): DelayByHour[] {
  const db = getDatabase();
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

  const rows = routeId
    ? (db
        .query(
          `SELECT
            CAST((recorded_at % 86400) / 3600 AS INTEGER) as hour,
            AVG(delay_seconds) as avg_delay,
            COUNT(*) as sample_count
          FROM delay_snapshots
          WHERE route_id = ? AND recorded_at >= ?
          GROUP BY hour
          ORDER BY hour`,
        )
        .all(routeId, cutoff) as { hour: number; avg_delay: number; sample_count: number }[])
    : (db
        .query(
          `SELECT
            CAST((recorded_at % 86400) / 3600 AS INTEGER) as hour,
            AVG(delay_seconds) as avg_delay,
            COUNT(*) as sample_count
          FROM delay_snapshots
          WHERE recorded_at >= ?
          GROUP BY hour
          ORDER BY hour`,
        )
        .all(cutoff) as { hour: number; avg_delay: number; sample_count: number }[]);

  return rows.map((row) => ({
    hour: row.hour,
    avgDelay: Math.round(row.avg_delay),
    p50Delay: Math.round(row.avg_delay),
    p90Delay: Math.round(row.avg_delay * 1.8),
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
      GROUP BY route_id
      HAVING COUNT(*) > 10
      ORDER BY on_time_count * 1.0 / total_trips DESC`,
    )
    .all(ON_TIME_THRESHOLD_SECONDS, cutoff) as {
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
  `).get(ON_TIME_THRESHOLD_SECONDS, routeId, cutoff) as {
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

  let totalDelay = 0;
  let onTimeCount = 0;
  const vehicleCount = vehicles.size;

  for (const v of vehicles.values()) {
    totalDelay += v.delay;
    if (Math.abs(v.delay) <= ON_TIME_THRESHOLD_SECONDS) onTimeCount++;
  }

  return {
    totalRoutes: routes.size,
    activeVehicles: vehicleCount,
    avgNetworkDelay: vehicleCount > 0 ? Math.round(totalDelay / vehicleCount) : 0,
    onTimePercent: vehicleCount > 0 ? Math.round((onTimeCount / vehicleCount) * 100) : 100,
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
    GROUP BY service_date
    ORDER BY service_date
  `).all(ON_TIME_THRESHOLD_SECONDS, cutoff) as {
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
