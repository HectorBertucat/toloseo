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
  // True when `delay` comes from a TripUpdate whose extractDelay logic found
  // a usable passenger-relevant stopTimeUpdate. False for VehiclePosition-only
  // entities (delay=0 is a stub, not a measurement). Used by analytics to
  // avoid polluting the "on-time" bucket with synthetic zeros.
  isRealtimeDelay?: boolean;
}

export interface NextStopInfo {
  stopId: string;
  stopName: string;
  stopSequence: number;
  scheduledArrival: number; // unix ms (0 if unknown)
  estimatedArrival: number; // unix ms
  delay: number; // seconds
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

export interface FeedHealth {
  // Age of the upstream GTFS-RT feed header, in ms. Undefined if the server
  // never received a header timestamp. Clients should grey out positions when
  // this exceeds ~2 minutes.
  feedAgeMs?: number;
  feedStale?: boolean;
  refineIntervalMs?: number;
}

export interface SSEInitEvent extends FeedHealth {
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

export interface SSEHeartbeatEvent extends FeedHealth {
  type: "heartbeat";
  timestamp: number;
}

export type SSEEvent =
  | SSEInitEvent
  | SSEVehicleEvent
  | SSEAlertEvent
  | SSEHeartbeatEvent;

// ── Analytics types ──────────────────────────────────────────────────

export interface DelayDistribution {
  // Ordered buckets, aligned with DELAY_BUCKET_LABELS server-side.
  veryEarly: number;  // delay < -300s (> 5 min early)
  early: number;      // -300s <= delay < -60s
  onTime: number;     // -60s <= delay <= 300s
  late: number;       // 300s < delay <= 600s (up to 10 min late)
  veryLate: number;   // delay > 600s
}

export interface DelayByHour {
  hour: number;
  avgDelay: number;
  medianDelay: number;
  p50Delay: number; // deprecated, kept for compatibility
  p90Delay: number; // deprecated
  sampleCount: number;
  distribution: DelayDistribution;
}

export interface ReliabilityScore {
  routeId: string;
  onTimePercent: number;
  avgDelay: number;
  medianDelay: number;
  maxDelay: number;
  totalTrips: number;
  period: string;
  distribution: DelayDistribution;
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
