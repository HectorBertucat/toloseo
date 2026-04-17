import type {
  ApiResponse,
  TransitLine,
  Stop,
  DepartureInfo,
  Alert,
  BBox,
  AnalyticsSummary,
  DelayByHour,
  ReliabilityScore,
  TrendData,
  NextStopInfo,
} from "@shared/types";

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new ApiError(
      `API error: ${response.status} ${response.statusText}`,
      response.status,
    );
  }

  const body = (await response.json()) as ApiResponse<T>;

  if (!body.ok) {
    throw new ApiError(body.error, 0);
  }

  return body.data;
}

function bboxToQuery(bbox: BBox): string {
  return `bbox=${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`;
}

// ── Transit endpoints ───────────────────────────────────────

async function getLines(): Promise<TransitLine[]> {
  return fetchJson<TransitLine[]>("/api/lines");
}

interface LineShape {
  type: "Feature";
  geometry: {
    type: "LineString" | "MultiLineString";
    coordinates: number[][] | number[][][];
  };
  properties: Record<string, unknown>;
}

// Module-level cache: line shapes are immutable per GTFS release, safe to memoize.
const shapeCache = new Map<string, LineShape>();
const shapeInflight = new Map<string, Promise<LineShape>>();

async function getLineShape(lineId: string): Promise<LineShape> {
  const cached = shapeCache.get(lineId);
  if (cached) return cached;
  const inflight = shapeInflight.get(lineId);
  if (inflight) return inflight;
  const p = fetchJson<LineShape>(
    `/api/lines/${encodeURIComponent(lineId)}/shape`,
  )
    .then((shape) => {
      shapeCache.set(lineId, shape);
      shapeInflight.delete(lineId);
      return shape;
    })
    .catch((err) => {
      shapeInflight.delete(lineId);
      throw err;
    });
  shapeInflight.set(lineId, p);
  return p;
}

/**
 * Fire-and-forget prefetch on hover/touchstart. Never throws.
 */
function prefetchLineShape(lineId: string): void {
  if (shapeCache.has(lineId) || shapeInflight.has(lineId)) return;
  getLineShape(lineId).catch(() => {
    /* ignore */
  });
}

async function getStops(bbox?: BBox): Promise<Stop[]> {
  const query = bbox ? `?${bboxToQuery(bbox)}` : "";
  return fetchJson<Stop[]>(`/api/stops${query}`);
}

async function getLineStops(lineId: string): Promise<Stop[]> {
  return fetchJson<Stop[]>(`/api/lines/${encodeURIComponent(lineId)}/stops`);
}

async function getStopDepartures(stopId: string): Promise<DepartureInfo[]> {
  return fetchJson<DepartureInfo[]>(
    `/api/stops/${encodeURIComponent(stopId)}/departures`,
  );
}

async function getAlerts(): Promise<Alert[]> {
  return fetchJson<Alert[]>("/api/alerts");
}

async function getVehicleNextStops(vehicleId: string): Promise<NextStopInfo[]> {
  return fetchJson<NextStopInfo[]>(
    `/api/vehicles/${encodeURIComponent(vehicleId)}/next-stops`,
  );
}

// ── Analytics endpoints ─────────────────────────────────────

async function getAnalyticsSummary(): Promise<AnalyticsSummary> {
  return fetchJson<AnalyticsSummary>("/api/analytics/summary");
}

async function getDelayByHour(routeId?: string): Promise<DelayByHour[]> {
  const query = routeId
    ? `?routeId=${encodeURIComponent(routeId)}`
    : "";
  return fetchJson<DelayByHour[]>(`/api/analytics/delay-by-hour${query}`);
}

async function getReliability(): Promise<ReliabilityScore[]> {
  return fetchJson<ReliabilityScore[]>("/api/analytics/reliability");
}

async function getTrends(
  routeId?: string,
  days?: number,
): Promise<TrendData[]> {
  const params = new URLSearchParams();
  if (routeId) params.set("routeId", routeId);
  if (days) params.set("days", String(days));
  const query = params.toString();
  return fetchJson<TrendData[]>(
    `/api/analytics/trends${query ? `?${query}` : ""}`,
  );
}

export {
  ApiError,
  getLines,
  getLineShape,
  prefetchLineShape,
  getLineStops,
  getStops,
  getStopDepartures,
  getAlerts,
  getVehicleNextStops,
  getAnalyticsSummary,
  getDelayByHour,
  getReliability,
  getTrends,
};

export type { LineShape };
