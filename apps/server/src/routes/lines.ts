import type { Hono } from "hono";
import { getRoutes, getTrips, getShapes } from "../gtfs/store.js";
import type { ApiResponse, TransitLine } from "@shared/types.js";
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
