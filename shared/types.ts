// ── Transit domain types ─────────────────────────────────────────────

export type TransitMode = "metro" | "tram" | "bus" | "cable";

export interface TransitLine {
  id: string;
  shortName: string;
  longName: string;
  color: string;
  textColor: string;
  mode: TransitMode;
  vehicleCount: number;
  avgDelay: number;
}

export interface Stop {
  id: string;
  name: string;
  lat: number;
  lon: number;
  modes: TransitMode[];
  wheelchairAccessible: boolean;
}

export interface Vehicle {
  id: string;
  tripId: string;
  routeId: string;
  lat: number;
  lon: number;
  bearing: number;
  delay: number;
  stopSequence: number;
  label: string;
  timestamp: number;
}

export interface Alert {
  id: string;
  headerText: string;
  descriptionText: string;
  cause: string;
  effect: string;
  activePeriods: ActivePeriod[];
  informedEntities: InformedEntity[];
}

export interface ActivePeriod {
  start: number;
  end: number;
}

export interface InformedEntity {
  agencyId?: string;
  routeId?: string;
  stopId?: string;
  tripId?: string;
}

export interface DepartureInfo {
  routeId: string;
  routeShortName: string;
  routeColor: string;
  tripHeadsign: string;
  scheduledTime: number;
  delay: number;
  estimatedTime: number;
  isRealtime: boolean;
}

// ── SSE event types ──────────────────────────────────────────────────

export interface SSEInitEvent {
  type: "init";
  vehicles: Vehicle[];
  alerts: Alert[];
  timestamp: number;
}

export interface SSEVehicleEvent {
  type: "vehicles";
  updated: Vehicle[];
  removed: string[];
  timestamp: number;
}

export interface SSEAlertEvent {
  type: "alerts";
  alerts: Alert[];
  timestamp: number;
}

export interface SSEHeartbeatEvent {
  type: "heartbeat";
  timestamp: number;
}

export type SSEEvent =
  | SSEInitEvent
  | SSEVehicleEvent
  | SSEAlertEvent
  | SSEHeartbeatEvent;

// ── Analytics types ──────────────────────────────────────────────────

export interface DelayByHour {
  hour: number;
  avgDelay: number;
  p50Delay: number;
  p90Delay: number;
  sampleCount: number;
}

export interface ReliabilityScore {
  routeId: string;
  onTimePercent: number;
  avgDelay: number;
  maxDelay: number;
  totalTrips: number;
  period: string;
}

export interface AnalyticsSummary {
  totalRoutes: number;
  activeVehicles: number;
  avgNetworkDelay: number;
  onTimePercent: number;
  activeAlerts: number;
  lastUpdated: number;
}

export interface TrendData {
  date: string;
  avgDelay: number;
  onTimePercent: number;
  vehicleCount: number;
}

// ── Geo types ────────────────────────────────────────────────────────

export interface BBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

// ── API response wrapper ─────────────────────────────────────────────

export type ApiResponse<T> =
  | { ok: true; data: T; timestamp: number }
  | { ok: false; error: string; timestamp: number };
