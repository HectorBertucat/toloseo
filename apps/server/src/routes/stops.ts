import type { Hono } from "hono";
import {
  getStops,
  getStopTimes,
  getTrips,
  getRoutes,
  getVehicles,
  getVehiclePredictions,
  getActiveServicesForDate,
} from "../gtfs/store.js";
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

const GROUP_RADIUS_METERS = 100;

function stopsInSameGroup(stopId: string): Set<string> {
  const stops = getStops();
  const root = stops.get(stopId);
  const group = new Set<string>([stopId]);
  if (!root?.name) return group;
  const normName = normalizeStopName(root.name);
  for (const [id, s] of stops) {
    if (id === stopId) continue;
    if (normalizeStopName(s.name) !== normName) continue;
    if (haversineMeters(root.lat, root.lon, s.lat, s.lon) > GROUP_RADIUS_METERS) continue;
    group.add(id);
  }
  return group;
}

function normalizeStopName(name: string): string {
  return name
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function computeDepartures(stopId: string): DepartureInfo[] {
  const stopTimesMap = getStopTimes();
  const trips = getTrips();
  const routes = getRoutes();
  const vehicles = getVehicles();
  const predictionsMap = getVehiclePredictions();
  const serviceDate = getCurrentServiceDate();
  const activeServices = getActiveServicesForDate(serviceDate);
  const now = Date.now();
  const results: DepartureInfo[] = [];
  const groupIds = stopsInSameGroup(stopId);

  // Index vehicles by tripId for quick lookup
  const vehicleByTrip = new Map<string, typeof vehicles extends Map<string, infer V> ? V : never>();
  for (const v of vehicles.values()) {
    if (v.tripId) vehicleByTrip.set(v.tripId, v);
  }

  for (const [tripId, times] of stopTimesMap) {
    const stopTime = times.find((st) => groupIds.has(st.stopId));
    if (!stopTime) continue;

    const trip = trips.get(tripId);
    if (!trip) continue;
    if (!activeServices.has(trip.serviceId)) continue;

    const scheduledMs = parseGtfsTime(stopTime.departureTime, serviceDate);
    if (scheduledMs < now - 60_000) continue;
    if (scheduledMs > now + 2 * 3600_000) continue; // next 2 hours

    const route = routes.get(trip.routeId);

    // Look for a live RT prediction for any stop in the group (both
    // directions of the same platform pair, handicap/regular duplicates…)
    const vehicle = vehicleByTrip.get(tripId);
    const predictions = vehicle ? predictionsMap.get(vehicle.id) : null;
    const predForStop = predictions?.find((p) => groupIds.has(p.stopId));

    let delay = 0;
    let estimatedMs = scheduledMs;
    let isRealtime = false;

    if (predForStop) {
      // Use the per-stop predicted arrival/departure if available
      const predMs = (predForStop.departure || predForStop.arrival) * 1000;
      if (predMs > 0) {
        const candidateDelay = Math.round((predMs - scheduledMs) / 1000);
        // Reject predictions that diverge by more than 30 min from schedule
        // (feed occasionally ships stale or wrongly-matched predictions).
        if (Math.abs(candidateDelay) <= 900) {
          estimatedMs = predMs;
          delay = candidateDelay;
          isRealtime = true;
        }
      }
    } else if (vehicle && Math.abs(vehicle.delay) <= 900) {
      // Fallback to the trip-wide delay from the vehicle (same sanity bound)
      delay = vehicle.delay;
      estimatedMs = scheduledMs + delay * 1000;
      isRealtime = delay !== 0;
    }

    results.push({
      routeId: trip.routeId,
      routeShortName: route?.shortName ?? "",
      routeColor: route?.color ?? "#888888",
      tripHeadsign: trip.headsign,
      scheduledTime: scheduledMs,
      delay,
      estimatedTime: estimatedMs,
      isRealtime,
    });
  }

  results.sort((a, b) => a.estimatedTime - b.estimatedTime);
  return results.slice(0, 12);
}
