import type { Hono } from "hono";
import { getRoutes, getTrips, getShapes, getStopTimes, getStops } from "../gtfs/store.js";
import type { ApiResponse, TransitLine, Stop } from "@shared/types.js";
import type { GeoJsonLineString } from "../gtfs/store.js";

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
  const trips = getTrips();
  const shapes = getShapes();

  for (const trip of trips.values()) {
    if (trip.routeId === routeId && trip.shapeId) {
      const shape = shapes.get(trip.shapeId);
      if (shape) return shape;
    }
  }

  return null;
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
