import type { Hono } from "hono";
import { getRoutes, getTrips, getShapes, getStopTimes, getStops } from "../gtfs/store.js";
import type { ApiResponse, TransitLine, Stop } from "@shared/types.js";
import type { GeoJsonLineString } from "../gtfs/store.js";

// Lazy-built index: routeId → shapeId. Invalidated by mutation count snapshot.
let routeShapeIndex: Map<string, string> | null = null;
let indexedTripsSize = -1;

function getRouteShapeIndex(): Map<string, string> {
  const trips = getTrips();
  if (routeShapeIndex && trips.size === indexedTripsSize) {
    return routeShapeIndex;
  }
  const index = new Map<string, string>();
  for (const trip of trips.values()) {
    if (trip.shapeId && !index.has(trip.routeId)) {
      index.set(trip.routeId, trip.shapeId);
    }
  }
  routeShapeIndex = index;
  indexedTripsSize = trips.size;
  return index;
}

export function registerLineRoutes(app: Hono): void {
  app.get("/api/lines", (c) => {
    const routes = getRoutes();
    const lines = Array.from(routes.values());
    const response: ApiResponse<TransitLine[]> = {
      ok: true,
      data: lines,
      timestamp: Date.now(),
    };
    return c.json(response);
  });

  app.get("/api/lines/:id/shape", (c) => {
    const routeId = c.req.param("id");
    const shape = findShapeForRoute(routeId);

    if (!shape) {
      return c.json(
        { ok: false, error: "Shape not found", timestamp: Date.now() },
        404,
      );
    }

    // Shapes are immutable per GTFS release. Encourage client + CDN cache.
    c.header("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");

    return c.json({
      ok: true,
      data: {
        type: "Feature" as const,
        geometry: shape,
        properties: { routeId },
      },
      timestamp: Date.now(),
    });
  });

  app.get("/api/lines/:id/stops", (c) => {
    const routeId = c.req.param("id");
    const stops = findStopsForRoute(routeId);
    const response: ApiResponse<Stop[]> = {
      ok: true,
      data: stops,
      timestamp: Date.now(),
    };
    return c.json(response);
  });
}

function findShapeForRoute(routeId: string): GeoJsonLineString | null {
  const shapeId = getRouteShapeIndex().get(routeId);
  if (!shapeId) return null;
  return getShapes().get(shapeId) ?? null;
}

function findStopsForRoute(routeId: string): Stop[] {
  const trips = getTrips();
  const stopTimes = getStopTimes();
  const stops = getStops();

  const stopIds = new Set<string>();
  for (const trip of trips.values()) {
    if (trip.routeId !== routeId) continue;
    const times = stopTimes.get(trip.tripId);
    if (!times) continue;
    for (const st of times) {
      stopIds.add(st.stopId);
    }
  }

  const result: Stop[] = [];
  for (const id of stopIds) {
    const stop = stops.get(id);
    if (stop) result.push(stop);
  }
  return result;
}
