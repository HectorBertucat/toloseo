import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { buildFetchHeaders, handleEtagResponse } from "../utils/etag.js";
import {
  getVehicles,
  getTrips,
  getRoutes,
  getVehiclePredictions,
  setAlerts,
  setLastPollTime,
  setHasVehiclePositions,
  getHasVehiclePositions,
  setFeedHeaderTimestamp,
  type PredictedStop,
} from "./store.js";
import { interpolateVehiclePosition } from "./interpolator.js";
import type { Vehicle, Alert, ActivePeriod, InformedEntity } from "@shared/types.js";

const { transit_realtime: rt } = GtfsRealtimeBindings;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let refineTimer: ReturnType<typeof setInterval> | null = null;

export const REFINE_INTERVAL_MS = 2_000;

// Schedule relationship values we ignore entirely: cancelled / skipped trips
// should not show up on the map nor pollute analytics with a synthetic 0.
const SR_CANCELED = 3;
const SR_SKIPPED = 1; // on stopTimeUpdate.scheduleRelationship
const SR_TRIP_SCHEDULED = 0;
const SR_TRIP_CANCELED = 3;

export function startRealtimePoller(): void {
  logger.info(
    { intervalMs: config.pollingIntervalMs, refineMs: REFINE_INTERVAL_MS },
    "starting GTFS-RT poller",
  );
  pollOnce();
  pollTimer = setInterval(pollOnce, config.pollingIntervalMs);
  refineTimer = setInterval(refineVehiclePositions, REFINE_INTERVAL_MS);
}

export function stopRealtimePoller(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (refineTimer) {
    clearInterval(refineTimer);
    refineTimer = null;
  }
}

/**
 * Between feed pulls, recompute each vehicle's position from the stored
 * predictions + current wall time. Moves vehicles smoothly on the map
 * without re-fetching.
 */
function refineVehiclePositions(): void {
  const vehicles = getVehicles();
  const predictionsMap = getVehiclePredictions();
  if (vehicles.size === 0) return;

  const nowMs = Date.now();
  for (const [id, v] of vehicles) {
    const predictions = predictionsMap.get(id) ?? null;
    const pos = interpolateVehiclePosition(v.tripId, v.delay, nowMs, predictions);
    if (!pos) continue;
    v.lat = pos.lat;
    v.lon = pos.lon;
    // EMA-smooth the bearing so the chevron doesn't flicker when a bus
    // dwells at a stop and the prev/next segment bearing flips.
    v.bearing = smoothBearing(v.bearing, pos.bearing);
    v.timestamp = Math.floor(nowMs / 1000);
  }
}

const BEARING_EMA_ALPHA = 0.3;
function smoothBearing(prev: number, next: number): number {
  if (!Number.isFinite(prev) || prev === 0) return next;
  // Unwrap across the 0/360 boundary for a stable blend.
  let diff = next - prev;
  if (diff > 180) diff -= 360;
  else if (diff < -180) diff += 360;
  const blended = prev + BEARING_EMA_ALPHA * diff;
  return (blended + 360) % 360;
}

async function pollOnce(): Promise<void> {
  try {
    await Promise.allSettled([
      pollTripUpdates(),
      pollAlerts(),
    ]);
    setLastPollTime(Date.now());
  } catch (err) {
    logger.error({ err }, "GTFS-RT poll cycle failed");
  }
}

async function pollTripUpdates(): Promise<void> {
  const url = config.gtfsRtUrl;
  const headers = buildFetchHeaders(url);
  const response = await fetch(url, { headers });

  if (!handleEtagResponse(url, response)) {
    logger.debug("GTFS-RT trip updates: not modified");
    return;
  }

  if (!response.ok) {
    logger.warn({ status: response.status }, "GTFS-RT trip updates fetch failed");
    return;
  }

  const buffer = await response.arrayBuffer();
  const feed = rt.FeedMessage.decode(new Uint8Array(buffer));
  const headerTs = toNumber(feed.header?.timestamp);
  if (headerTs > 0) setFeedHeaderTimestamp(headerTs * 1000);
  processFeedEntities(feed.entity ?? []);
}

/**
 * Two-pass merge of feed entities:
 *   Pass 1 — consume every TripUpdate. These carry the passenger-relevant
 *            delay and the ordered stopTimeUpdate[] predictions we use to
 *            interpolate a position along the shape.
 *   Pass 2 — enrich each Vehicle with its VehiclePosition (raw GPS lat/lon
 *            and bearing) when present, but NEVER overwrite delay/tripId/
 *            routeId/predictions. This prevents the longstanding bug where
 *            a VehiclePosition without delay info was clobbering a good
 *            TripUpdate because both handlers called `vehicles.set(...)`.
 *
 * TripUpdates that are CANCELED / all-SKIPPED are dropped outright.
 */
function processFeedEntities(
  entities: GtfsRealtimeBindings.transit_realtime.IFeedEntity[],
): void {
  const vehicles = getVehicles();
  const trips = getTrips();
  const seenVehicleIds = new Set<string>();
  let vehiclePositionCount = 0;
  let interpolatedCount = 0;
  let canceledCount = 0;
  const now = Date.now();

  // Index VehiclePositions by vehicleId for the enrichment pass.
  const vpByVehicleId = new Map<
    string,
    GtfsRealtimeBindings.transit_realtime.IVehiclePosition
  >();
  for (const entity of entities) {
    if (entity.vehicle) {
      const id = entity.vehicle.vehicle?.id ?? entity.vehicle.vehicle?.label ?? "";
      if (id) vpByVehicleId.set(id, entity.vehicle);
    }
  }

  // Pass 1 — TripUpdate authoritative for delay + predictions.
  const handledIds = new Set<string>();
  for (const entity of entities) {
    if (!entity.tripUpdate) continue;

    const sr = entity.tripUpdate.trip?.scheduleRelationship ?? SR_TRIP_SCHEDULED;
    if (sr === SR_TRIP_CANCELED) {
      canceledCount++;
      continue;
    }

    const v = processTripUpdate(entity.tripUpdate, trips, now);
    if (!v) continue;
    vehicles.set(v.id, v);
    seenVehicleIds.add(v.id);
    handledIds.add(v.id);
    interpolatedCount++;
  }

  // Pass 2 — enrich with VehiclePosition, or create a stub if we never saw
  // a TripUpdate for that vehicle.
  for (const [id, vp] of vpByVehicleId) {
    if (handledIds.has(id)) {
      enrichWithVehiclePosition(vehicles.get(id)!, vp);
      vehiclePositionCount++;
      seenVehicleIds.add(id);
      continue;
    }
    const stub = buildStubFromVehiclePosition(vp, trips);
    if (!stub) continue;
    vehicles.set(stub.id, stub);
    seenVehicleIds.add(stub.id);
    vehiclePositionCount++;
  }

  if (vehiclePositionCount > 0 && !getHasVehiclePositions()) {
    setHasVehiclePositions(true);
    logger.info("GTFS-RT feed includes VehiclePosition entities");
  }

  removeStaleVehicles(vehicles, seenVehicleIds);
  updateRouteStats();

  logger.debug(
    {
      entities: entities.length,
      vehicles: vehicles.size,
      fromVehiclePosition: vehiclePositionCount,
      fromTripUpdate: interpolatedCount,
      canceled: canceledCount,
    },
    "GTFS-RT trip updates processed",
  );
}

function processTripUpdate(
  tu: GtfsRealtimeBindings.transit_realtime.ITripUpdate,
  trips: Map<string, { routeId: string }>,
  nowMs: number,
): Vehicle | null {
  const tripId = tu.trip?.tripId ?? "";
  if (!tripId) return null;

  const trip = trips.get(tripId);
  if (!trip) return null;

  // Drop predictions for stops marked SKIPPED — they pollute both delay
  // extraction and the interpolator with stale scheduled times.
  const stopUpdates = (tu.stopTimeUpdate ?? []).filter(
    (s) => (s.scheduleRelationship ?? 0) !== SR_SKIPPED,
  );
  if (stopUpdates.length === 0 && (tu.stopTimeUpdate?.length ?? 0) > 0) {
    return null;
  }

  const { delay, hasRealtimeDelay } = extractDelay(tu, stopUpdates);

  const predictions: PredictedStop[] = [];
  for (const stu of stopUpdates) {
    predictions.push({
      stopSequence: stu.stopSequence ?? 0,
      stopId: stu.stopId ?? "",
      arrival: toNumber(stu.arrival?.time) || 0,
      departure: toNumber(stu.departure?.time) || 0,
    });
  }

  const vehicleId = tu.vehicle?.id ?? `tu-${tripId}`;
  const currentStopSequence = stopUpdates[0]?.stopSequence ?? 0;

  // Save predictions for later use (analytics, next-stop, etc.) — even if
  // interpolation fails, these are consumed by /departures and /next-stops.
  if (predictions.length > 0) {
    getVehiclePredictions().set(vehicleId, predictions);
  }

  const position = interpolateVehiclePosition(tripId, delay, nowMs, predictions);
  if (!position) return null;

  return {
    id: vehicleId,
    tripId,
    routeId: trip.routeId,
    lat: position.lat,
    lon: position.lon,
    bearing: position.bearing,
    delay,
    stopSequence: currentStopSequence,
    label: tu.vehicle?.label ?? vehicleId,
    timestamp: toNumber(tu.timestamp) || Math.floor(nowMs / 1000),
    isRealtimeDelay: hasRealtimeDelay,
  };
}

/**
 * Best-effort current delay for a trip, from the passenger's perspective.
 *
 * GTFS-RT delays come both at the trip level and per stopTimeUpdate.
 * Toulouse's feed populates the trip-level delay with 0 and fills the real
 * values per-stop. Picking the wrong stop creates systematic bias:
 *   - Using the FIRST stop's `arrival.delay` captures the bus's early
 *     pre-positioning at the terminus (often -2 to -5 min) and falsely
 *     labels the whole trip as "early".
 *   - Using `departure.delay` for the last stop is meaningless (no one
 *     boards there).
 *
 * Strategy (in order):
 *   1. Scan stopTimeUpdates from the next intermediate stop onwards (skip
 *      the very first stop for arrival-based delays — that's the terminus
 *      pre-position bias we want to avoid).
 *   2. Prefer `arrival.delay` (that's what the passenger waits for) except
 *      at the last stop.
 *   3. Filter out already-passed stops: tolerance 30s on feed-provided
 *      stop times. Stale "past" entries are the #1 pollution source.
 *   4. Fall back to trip.delay.
 */
export function extractDelay(
  tu: GtfsRealtimeBindings.transit_realtime.ITripUpdate,
  updatesOverride?: GtfsRealtimeBindings.transit_realtime.TripUpdate.IStopTimeUpdate[],
): { delay: number; hasRealtimeDelay: boolean } {
  const updates = updatesOverride ?? tu.stopTimeUpdate ?? [];
  const nowS = Math.floor(Date.now() / 1000);
  const cutoff = nowS - PAST_STOP_TOLERANCE_S;

  if (updates.length === 0) {
    if (tu.delay != null) return { delay: tu.delay, hasRealtimeDelay: true };
    return { delay: 0, hasRealtimeDelay: false };
  }

  const minSeq = updates.reduce(
    (m, s) => Math.min(m, s.stopSequence ?? Number.MAX_SAFE_INTEGER),
    Number.MAX_SAFE_INTEGER,
  );
  const maxSeq = updates.reduce(
    (m, s) => Math.max(m, s.stopSequence ?? 0),
    0,
  );

  let lastFutureDelay: number | null = null;
  let terminusFallback: number | null = null;

  for (const stu of updates) {
    const seq = stu.stopSequence ?? 0;
    const t = toNumber(stu.arrival?.time) || toNumber(stu.departure?.time);
    if (t > 0 && t < cutoff) continue; // already-passed, stale

    const a = stu.arrival?.delay;
    const d = stu.departure?.delay;
    const isFirst = seq === minSeq;
    const isLast = seq === maxSeq;

    // Terminus start: arrival.delay here is the pre-position bias. Keep
    // only departure.delay as a weak fallback.
    if (isFirst) {
      if (d != null) terminusFallback = d;
      continue;
    }

    // Last stop: departure.delay is meaningless (no one boards). Allow
    // arrival.delay only.
    if (isLast) {
      if (a != null && a !== 0) return { delay: a, hasRealtimeDelay: true };
      if (a != null) lastFutureDelay = a;
      continue;
    }

    // Intermediate stop: arrival.delay is the passenger-relevant metric.
    if (a != null && a !== 0) return { delay: a, hasRealtimeDelay: true };
    if (d != null && d !== 0) return { delay: d, hasRealtimeDelay: true };
    if (a != null) lastFutureDelay = a;
    else if (d != null) lastFutureDelay = d;
  }

  if (lastFutureDelay != null) {
    return { delay: lastFutureDelay, hasRealtimeDelay: true };
  }
  if (terminusFallback != null) {
    return { delay: terminusFallback, hasRealtimeDelay: true };
  }
  if (tu.delay != null) return { delay: tu.delay, hasRealtimeDelay: true };
  return { delay: 0, hasRealtimeDelay: false };
}

const PAST_STOP_TOLERANCE_S = 30;

/**
 * Returns the delay relevant to a specific future stop, preferring that
 * stop's own stopTimeUpdate over the trip-wide delay.
 */
export function delayAtStop(
  predictions: Array<{ stopSequence: number; arrival: number; departure: number }>,
  scheduledArrival: number,
  scheduledDeparture: number,
  stopSequence: number,
): number {
  const p = predictions.find((x) => x.stopSequence === stopSequence);
  if (!p) return 0;
  if (p.arrival > 0 && scheduledArrival > 0) {
    return p.arrival - Math.floor(scheduledArrival / 1000);
  }
  if (p.departure > 0 && scheduledDeparture > 0) {
    return p.departure - Math.floor(scheduledDeparture / 1000);
  }
  return 0;
}

function enrichWithVehiclePosition(
  vehicle: Vehicle,
  vp: GtfsRealtimeBindings.transit_realtime.IVehiclePosition,
): void {
  // Only adopt the raw GPS position if it's fresh — feeds occasionally
  // send stale positions alongside a newer TripUpdate, in which case our
  // interpolated position is closer to the truth.
  const vpTs = toNumber(vp.timestamp);
  if (vpTs > 0 && vpTs + 60 < vehicle.timestamp) return;

  const lat = vp.position?.latitude ?? 0;
  const lon = vp.position?.longitude ?? 0;
  if (lat !== 0 || lon !== 0) {
    vehicle.lat = lat;
    vehicle.lon = lon;
  }
  const bearing = vp.position?.bearing;
  if (bearing != null && bearing !== 0) {
    vehicle.bearing = bearing;
  }
  if (vpTs > 0) vehicle.timestamp = vpTs;
}

function buildStubFromVehiclePosition(
  vp: GtfsRealtimeBindings.transit_realtime.IVehiclePosition,
  trips: Map<string, { routeId: string }>,
): Vehicle | null {
  const vehicleId = vp.vehicle?.id ?? vp.vehicle?.label ?? "";
  if (!vehicleId) return null;

  const tripId = vp.trip?.tripId ?? "";
  const trip = trips.get(tripId);
  const routeId = vp.trip?.routeId ?? trip?.routeId ?? "";

  return {
    id: vehicleId,
    tripId,
    routeId,
    lat: vp.position?.latitude ?? 0,
    lon: vp.position?.longitude ?? 0,
    bearing: vp.position?.bearing ?? 0,
    delay: 0,
    stopSequence: vp.currentStopSequence ?? 0,
    label: vp.vehicle?.label ?? vehicleId,
    timestamp: toNumber(vp.timestamp) || Math.floor(Date.now() / 1000),
    isRealtimeDelay: false, // delay is a stub, not a measurement
  };
}

function removeStaleVehicles(
  vehicles: Map<string, Vehicle>,
  seenIds: Set<string>,
): void {
  if (seenIds.size === 0) return;
  const cutoff = Date.now() / 1000 - 300;
  const predictions = getVehiclePredictions();
  for (const [id, v] of vehicles) {
    if (!seenIds.has(id) && v.timestamp < cutoff) {
      vehicles.delete(id);
      predictions.delete(id);
    }
  }
}

function updateRouteStats(): void {
  const routes = getRoutes();
  const vehicles = getVehicles();

  const countByRoute = new Map<string, { count: number; totalDelay: number; rt: number }>();
  for (const v of vehicles.values()) {
    const entry = countByRoute.get(v.routeId) ?? { count: 0, totalDelay: 0, rt: 0 };
    entry.count++;
    if (v.isRealtimeDelay) {
      entry.totalDelay += v.delay;
      entry.rt++;
    }
    countByRoute.set(v.routeId, entry);
  }

  for (const [routeId, route] of routes) {
    const stats = countByRoute.get(routeId);
    route.vehicleCount = stats?.count ?? 0;
    // Only average over vehicles with a real RT delay signal — avoids
    // the old bug where VehiclePosition stubs at delay=0 dragged the
    // route-level average to zero.
    route.avgDelay = stats && stats.rt > 0 ? Math.round(stats.totalDelay / stats.rt) : 0;
  }
}

async function pollAlerts(): Promise<void> {
  const url = config.gtfsRtAlertsUrl;
  const headers = buildFetchHeaders(url);
  const response = await fetch(url, { headers });

  if (!handleEtagResponse(url, response)) return;

  if (!response.ok) {
    logger.warn({ status: response.status }, "GTFS-RT alerts fetch failed");
    return;
  }

  const buffer = await response.arrayBuffer();
  const feed = rt.FeedMessage.decode(new Uint8Array(buffer));
  const alerts = extractAlerts(feed.entity ?? []);
  setAlerts(alerts);

  logger.debug({ count: alerts.length }, "GTFS-RT alerts processed");
}

function extractAlerts(
  entities: GtfsRealtimeBindings.transit_realtime.IFeedEntity[],
): Alert[] {
  const result: Alert[] = [];

  for (const entity of entities) {
    if (!entity.alert) continue;
    const a = entity.alert;

    const alert: Alert = {
      id: entity.id ?? "",
      headerText: getTranslation(a.headerText),
      descriptionText: getTranslation(a.descriptionText),
      cause: String(a.cause ?? "UNKNOWN_CAUSE"),
      effect: String(a.effect ?? "UNKNOWN_EFFECT"),
      activePeriods: mapActivePeriods(a.activePeriod ?? []),
      informedEntities: mapInformedEntities(a.informedEntity ?? []),
    };
    result.push(alert);
  }

  return result;
}

function getTranslation(
  text: GtfsRealtimeBindings.transit_realtime.ITranslatedString | null | undefined,
): string {
  if (!text?.translation?.length) return "";
  const fr = text.translation.find((t) => t.language === "fr");
  return fr?.text ?? text.translation[0]?.text ?? "";
}

function mapActivePeriods(
  periods: GtfsRealtimeBindings.transit_realtime.ITimeRange[],
): ActivePeriod[] {
  return periods.map((p) => ({
    start: toNumber(p.start) || 0,
    end: toNumber(p.end) || 0,
  }));
}

function mapInformedEntities(
  entities: GtfsRealtimeBindings.transit_realtime.IEntitySelector[],
): InformedEntity[] {
  return entities.map((e) => ({
    agencyId: e.agencyId ?? undefined,
    routeId: e.routeId ?? undefined,
    stopId: e.stopId ?? undefined,
    tripId: e.trip?.tripId ?? undefined,
  }));
}

function toNumber(
  val: number | Long | null | undefined,
): number {
  if (val == null) return 0;
  if (typeof val === "number") return val;
  return (val as { toNumber?: () => number }).toNumber?.() ?? 0;
}

// Silence unused-SR-constant warnings for values kept for documentation.
void SR_CANCELED;

type Long = { toNumber: () => number };
