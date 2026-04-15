import type { Hono } from "hono";
import { getStops, getStopTimes, getTrips, getRoutes, getVehicles } from "../gtfs/store.js";
import { isInBbox, parseBbox } from "../utils/geo.js";
import { parseGtfsTime, getCurrentServiceDate } from "../utils/time.js";
import type { ApiResponse, Stop, DepartureInfo } from "@shared/types.js";

export function registerStopRoutes(app: Hono): void {
  app.get("/api/stops", (c) => {
    const bboxRaw = c.req.query("bbox");
    const stops = getStops();

    if (!bboxRaw) {
      const all = Array.from(stops.values());
      const response: ApiResponse<Stop[]> = {
        ok: true,
        data: all,
        timestamp: Date.now(),
      };
      return c.json(response);
    }

    const bbox = parseBbox(bboxRaw);
    if (!bbox) {
      return c.json(
        { ok: false, error: "Invalid bbox format", timestamp: Date.now() },
        400,
      );
    }

    const filtered = Array.from(stops.values()).filter((s) =>
      isInBbox(s.lat, s.lon, bbox),
    );

    return c.json({ ok: true, data: filtered, timestamp: Date.now() });
  });

  app.get("/api/stops/:id/departures", (c) => {
    const stopId = c.req.param("id");
    const stop = getStops().get(stopId);

    if (!stop) {
      return c.json(
        { ok: false, error: "Stop not found", timestamp: Date.now() },
        404,
      );
    }

    const departures = computeDepartures(stopId);
    const response: ApiResponse<DepartureInfo[]> = {
      ok: true,
      data: departures,
      timestamp: Date.now(),
    };
    return c.json(response);
  });
}

function computeDepartures(stopId: string): DepartureInfo[] {
  const stopTimesMap = getStopTimes();
  const trips = getTrips();
  const routes = getRoutes();
  const vehicles = getVehicles();
  const serviceDate = getCurrentServiceDate();
  const now = Date.now();
  const results: DepartureInfo[] = [];

  for (const [tripId, times] of stopTimesMap) {
    const stopTime = times.find((st) => st.stopId === stopId);
    if (!stopTime) continue;

    const trip = trips.get(tripId);
    if (!trip) continue;

    const scheduled = parseGtfsTime(stopTime.departureTime, serviceDate);
    if (scheduled < now - 60_000) continue;
    if (scheduled > now + 3600_000) continue;

    const route = routes.get(trip.routeId);
    const delay = findVehicleDelay(tripId, vehicles);

    results.push({
      routeId: trip.routeId,
      routeShortName: route?.shortName ?? "",
      routeColor: route?.color ?? "#888888",
      tripHeadsign: trip.headsign,
      scheduledTime: scheduled,
      delay,
      estimatedTime: scheduled + delay * 1000,
    });
  }

  results.sort((a, b) => a.estimatedTime - b.estimatedTime);
  return results.slice(0, 20);
}

function findVehicleDelay(
  tripId: string,
  vehicles: Map<string, { tripId: string; delay: number }>,
): number {
  for (const v of vehicles.values()) {
    if (v.tripId === tripId) return v.delay;
  }
  return 0;
}
