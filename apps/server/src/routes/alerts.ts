import type { Hono } from "hono";
import { getAlerts } from "../gtfs/store.js";
import type { ApiResponse, Alert } from "@shared/types.js";

export function registerAlertRoutes(app: Hono): void {
  app.get("/api/alerts", (c) => {
    const now = Date.now();
    const nowSec = Math.floor(now / 1000);
    const alerts = getAlerts();

    const active = alerts.filter((a) => isAlertActive(a, nowSec));

    const response: ApiResponse<Alert[]> = {
      ok: true,
      data: active,
      timestamp: now,
    };
    return c.json(response);
  });
}

function isAlertActive(alert: Alert, nowSec: number): boolean {
  if (alert.activePeriods.length === 0) return true;
  return alert.activePeriods.some(
    (p) =>
      (p.start === 0 || p.start <= nowSec) &&
      (p.end === 0 || p.end >= nowSec),
  );
}
