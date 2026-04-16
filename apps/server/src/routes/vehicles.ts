import type { Hono } from "hono";
import {
  getVehicles,
  getVehiclePredictions,
  getStops,
  getStopTimes,
} from "../gtfs/store.js";
import { parseGtfsTime, getCurrentServiceDate } from "../utils/time.js";
import type { ApiResponse, NextStopInfo } from "@shared/types.js";

export function registerVehicleRoutes(app: Hono): void {
  app.get("/api/vehicles/:id/next-stops", (c) => {
    const vehicleId = c.req.param("id");
    const vehicles = getVehicles();
    const vehicle = vehicles.get(vehicleId);

    if (!vehicle) {
      return c.json(
        { ok: false, error: "Vehicle not found", timestamp: Date.now() },
        404,
      );
    }

    const predictions = getVehiclePredictions().get(vehicleId) ?? [];
    const stops = getStops();
    const stopTimesMap = getStopTimes();
    const scheduleForTrip = stopTimesMap.get(vehicle.tripId) ?? [];
    const serviceDate = getCurrentServiceDate();
    const now = Date.now();

    const scheduleByStopId = new Map<string, (typeof scheduleForTrip)[number]>();
    for (const st of scheduleForTrip) scheduleByStopId.set(st.stopId, st);

    const futurePredictions = predictions.filter((p) => {
      const t = (p.arrival || p.departure) * 1000;
      return t === 0 || t >= now - 60_000;
    });

    const results: NextStopInfo[] = [];
    for (const p of futurePredictions) {
      const stop = stops.get(p.stopId);
      const scheduled = scheduleByStopId.get(p.stopId);
      const scheduledMs = scheduled
        ? parseGtfsTime(
            scheduled.arrivalTime || scheduled.departureTime,
            serviceDate,
          )
        : 0;
      const estimatedMs = (p.arrival || p.departure) * 1000;
      let delay = 0;
      if (estimatedMs > 0 && scheduledMs > 0) {
        delay = Math.round((estimatedMs - scheduledMs) / 1000);
        if (Math.abs(delay) > 1800) {
          // Fall back to theoretical when prediction is obviously stale
          delay = 0;
        }
      }
      results.push({
        stopId: p.stopId,
        stopName: stop?.name ?? p.stopId,
        stopSequence: p.stopSequence,
        scheduledArrival: scheduledMs,
        estimatedArrival: estimatedMs || scheduledMs,
        delay,
      });
    }

    results.sort(
      (a, b) =>
        (a.estimatedArrival || a.scheduledArrival) -
        (b.estimatedArrival || b.scheduledArrival),
    );

    const response: ApiResponse<NextStopInfo[]> = {
      ok: true,
      data: results.slice(0, 8),
      timestamp: Date.now(),
    };
    return c.json(response);
  });
}
