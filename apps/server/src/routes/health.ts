import type { Hono } from "hono";
import {
  isGtfsLoaded,
  getVehicles,
  getLastPollTime,
  getRoutes,
  getStops,
  getAlerts,
} from "../gtfs/store.js";

const startedAt = Date.now();

export function registerHealthRoutes(app: Hono): void {
  app.get("/api/health", (c) => {
    const now = Date.now();
    return c.json({
      ok: true,
      data: {
        status: "ok",
        uptime: Math.floor((now - startedAt) / 1000),
        gtfsLoaded: isGtfsLoaded(),
        vehicleCount: getVehicles().size,
        routeCount: getRoutes().size,
        stopCount: getStops().size,
        alertCount: getAlerts().length,
        lastPollTime: getLastPollTime(),
        lastPollAgo: getLastPollTime() > 0 ? now - getLastPollTime() : null,
      },
      timestamp: now,
    });
  });
}
