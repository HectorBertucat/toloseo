import type { Hono } from "hono";
import {
  queryDelayByHour,
  queryReliability,
  queryAllReliability,
  queryAnalyticsSummary,
  queryTrend,
} from "../analytics/aggregator.js";
import type { ApiResponse, DelayByHour, ReliabilityScore, AnalyticsSummary, TrendData } from "@shared/types.js";

export function registerAnalyticsRoutes(app: Hono): void {
  app.get("/api/analytics/delay-by-hour", (c) => {
    const routeId = c.req.query("routeId") ?? null;
    const period = c.req.query("period") ?? "7d";
    const days = parsePeriodDays(period);
    const data = queryDelayByHour(routeId, days);
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
    const data = queryAllReliability(days);
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

    const data = queryDelayByHour(routeId, days);
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

  const data = queryTrend(days);
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
