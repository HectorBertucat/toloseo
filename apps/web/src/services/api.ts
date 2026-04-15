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

async function getLineShape(lineId: string): Promise<LineShape> {
  return fetchJson<LineShape>(`/api/lines/${encodeURIComponent(lineId)}/shape`);
}

async function getStops(bbox?: BBox): Promise<Stop[]> {
  const query = bbox ? `?${bboxToQuery(bbox)}` : "";
  return fetchJson<Stop[]>(`/api/stops${query}`);
}

async function getStopDepartures(stopId: string): Promise<DepartureInfo[]> {
  return fetchJson<DepartureInfo[]>(
    `/api/stops/${encodeURIComponent(stopId)}/departures`,
  );
}

async function getAlerts(): Promise<Alert[]> {
  return fetchJson<Alert[]>("/api/alerts");
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
  getStops,
  getStopDepartures,
  getAlerts,
  getAnalyticsSummary,
  getDelayByHour,
  getReliability,
  getTrends,
};

export type { LineShape };
