import { getDatabase } from "./db.js";
import { logger } from "../logger.js";

/**
 * Simple historical delay model.
 *
 * For each (route_id, hour, day_type) we precompute the average observed
 * delay from the delay_snapshots table. This acts as a baseline expectation
 * that the realtime pipeline can blend with the current reported delay to
 * produce smoother, more realistic position estimates.
 *
 * The model refreshes itself once every 10 minutes (cache TTL).
 */

interface ModelKey {
  routeId: string;
  hour: number;
  dayType: DayType;
}

type DayType = "weekday" | "saturday" | "sunday" | "holiday" | "vacation";

const TTL_MS = 10 * 60_000;
const ON_TIME_THRESHOLD = 300; // 5 min

let cache = new Map<string, number>(); // key → avgDelaySec
let cacheExpiresAt = 0;

function keyFor(k: ModelKey): string {
  return `${k.routeId}|${k.hour}|${k.dayType}`;
}

function currentDayType(date: Date): DayType {
  // TODO: blend with holiday/vacation tables; for now weekday/saturday/sunday
  const day = date.getDay();
  if (day === 0) return "sunday";
  if (day === 6) return "saturday";
  return "weekday";
}

function refreshModel(): void {
  const db = getDatabase();
  const cutoff = Math.floor(Date.now() / 1000) - 30 * 86400; // last 30 days

  const rows = db
    .query(
      `SELECT route_id,
              CAST((recorded_at % 86400) / 3600 AS INTEGER) as hour,
              AVG(delay_seconds) as avg_delay,
              COUNT(*) as sample_count
       FROM delay_snapshots
       WHERE recorded_at >= ?
       GROUP BY route_id, hour
       HAVING COUNT(*) > 5`,
    )
    .all(cutoff) as {
    route_id: string;
    hour: number;
    avg_delay: number;
    sample_count: number;
  }[];

  const next = new Map<string, number>();
  for (const row of rows) {
    // We don't yet bucket by day type — use "weekday" as umbrella for now
    const key = keyFor({ routeId: row.route_id, hour: row.hour, dayType: "weekday" });
    next.set(key, Math.round(row.avg_delay));
  }

  cache = next;
  cacheExpiresAt = Date.now() + TTL_MS;
  logger.debug({ entries: cache.size }, "delay model refreshed");
}

/**
 * Returns the historical average delay in seconds for the given route at the
 * current hour/day-type. Returns null if no data is available yet.
 */
export function getExpectedDelay(routeId: string, nowMs: number = Date.now()): number | null {
  if (Date.now() > cacheExpiresAt) {
    try {
      refreshModel();
    } catch (err) {
      logger.warn({ err }, "delay model refresh failed");
    }
  }

  const date = new Date(nowMs);
  const hour = date.getHours();
  const dayType = currentDayType(date);

  const key = keyFor({ routeId, hour, dayType });
  const v = cache.get(key);
  if (v === undefined) return null;
  return v;
}

/**
 * Blend the realtime-reported delay with the historical expected delay.
 * Weight is biased toward RT because it's the source of truth when
 * available, but falls back to historical when RT is zero (which often
 * means "no data" on buses between updates).
 */
export function blendDelay(
  rtDelay: number,
  routeId: string,
  nowMs: number = Date.now(),
): number {
  const expected = getExpectedDelay(routeId, nowMs);
  if (expected === null) return rtDelay;
  if (rtDelay === 0) return expected; // RT is probably stale or missing
  return Math.round(rtDelay * 0.7 + expected * 0.3);
}

export { ON_TIME_THRESHOLD };
