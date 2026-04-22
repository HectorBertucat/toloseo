import type { Hono } from "hono";
import {
  queryDelayByHour,
  queryReliability,
  queryAllReliability,
  queryAnalyticsSummary,
  queryTrend,
} from "../analytics/aggregator.js";
import { cacheControl } from "../middleware/cache.js";
import type { ApiResponse, DelayByHour, ReliabilityScore, AnalyticsSummary, TrendData } from "@shared/types.js";

/**
 * Heavy aggregations on delay_snapshots are disabled until the composite
 * indexes (migration 5) are built. Without them, a single uncached request
 * blocks the bun:sqlite main thread for minutes and stalls every other
 * /api/* route. Flip to "1" once the indexes exist on the VPS.
 */
const ANALYTICS_HEAVY_ENABLED = process.env["ANALYTICS_HEAVY"] === "1";

const EMPTY_RELIABILITY: ReliabilityScore[] = [];
const EMPTY_DELAY: DelayByHour[] = [];
const EMPTY_TREND: TrendData[] = [];

export function registerAnalyticsRoutes(app: Hono): void {
  // Collector runs every 60s, so cache edge + browser for 60s. SWR lets
  // Cloudflare keep serving the old copy up to 5 min while it revalidates.
  app.use("/api/analytics/*", cacheControl(60, 300));

  app.get("/api/analytics/delay-by-hour", (c) => {
    const routeId = c.req.query("routeId") ?? null;
    const period = c.req.query("period") ?? "7d";
    const days = parsePeriodDays(period);
    const data = ANALYTICS_HEAVY_ENABLED
      ? queryDelayByHour(routeId, days)
      : EMPTY_DELAY;
    const response: ApiResponse<DelayByHour[]> = {
      ok: true,
      data,
      timestamp: Date.now(),
    };
    return c.json(response);
  });

  app.get("/api/analytics/reliability", (c) => {
    const period = c.req.query("period") ?? "7d";
    const days = parsePeriodDays(period);
    const data = ANALYTICS_HEAVY_ENABLED
      ? queryAllReliability(days)
      : EMPTY_RELIABILITY;
    const response: ApiResponse<ReliabilityScore[]> = {
      ok: true,
      data,
      timestamp: Date.now(),
    };
    return c.json(response);
  });

  app.get("/api/analytics/lines/:id/delay", (c) => {
    const routeId = c.req.param("id");
    const period = c.req.query("period") ?? "7d";
    const days = parsePeriodDays(period);

    const data = ANALYTICS_HEAVY_ENABLED
      ? queryDelayByHour(routeId, days)
      : EMPTY_DELAY;
    const response: ApiResponse<DelayByHour[]> = {
      ok: true,
      data,
      timestamp: Date.now(),
    };
    return c.json(response);
  });

  app.get("/api/analytics/lines/:id/reliability", (c) => {
    const routeId = c.req.param("id");
    const period = c.req.query("period") ?? "30d";
    const days = parsePeriodDays(period);

    if (!ANALYTICS_HEAVY_ENABLED) {
      return c.json(
        { ok: false, error: "Analytics temporarily unavailable", timestamp: Date.now() },
        503,
      );
    }

    const data = queryReliability(routeId, days);
    if (!data) {
      return c.json(
        { ok: false, error: "No data for route", timestamp: Date.now() },
        404,
      );
    }

    const response: ApiResponse<ReliabilityScore> = {
      ok: true,
      data,
      timestamp: Date.now(),
    };
    return c.json(response);
  });

  app.get("/api/analytics/summary", (c) => {
    // Summary only reads in-memory state (no SQLite) so it stays online.
    const data = queryAnalyticsSummary();
    const response: ApiResponse<AnalyticsSummary> = {
      ok: true,
      data,
      timestamp: Date.now(),
    };
    return c.json(response);
  });

  app.get("/api/analytics/trends", (c) => {
    return handleTrends(c);
  });

  app.get("/api/analytics/trend", (c) => {
    return handleTrends(c);
  });
}

function handleTrends(c: {
  req: { query: (key: string) => string | undefined };
  json: (body: unknown) => Response;
}): Response {
  const period = c.req.query("period") ?? "7d";
  const days = parsePeriodDays(period);

  const data = ANALYTICS_HEAVY_ENABLED ? queryTrend(days) : EMPTY_TREND;
  const response: ApiResponse<TrendData[]> = {
    ok: true,
    data,
    timestamp: Date.now(),
  };
  return c.json(response);
}

function parsePeriodDays(period: string): number {
  const match = period.match(/^(\d+)d$/);
  if (!match?.[1]) return 7;
  const days = parseInt(match[1], 10);
  return Math.min(Math.max(days, 1), 365);
}
