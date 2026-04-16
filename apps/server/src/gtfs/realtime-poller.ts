import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { buildFetchHeaders, handleEtagResponse } from "../utils/etag.js";
import {
  getVehicles,
  getTrips,
  getRoutes,
  setAlerts,
  setLastPollTime,
  setHasVehiclePositions,
  getHasVehiclePositions,
} from "./store.js";
import { interpolateVehiclePosition } from "./interpolator.js";
import type { Vehicle, Alert, ActivePeriod, InformedEntity } from "@shared/types.js";

const { transit_realtime: rt } = GtfsRealtimeBindings;

let pollTimer: ReturnType<typeof setInterval> | null = null;

export function startRealtimePoller(): void {
  logger.info(
    { intervalMs: config.pollingIntervalMs },
    "starting GTFS-RT poller",
  );
  pollOnce();
  pollTimer = setInterval(pollOnce, config.pollingIntervalMs);
}

export function stopRealtimePoller(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
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
  processFeedEntities(feed.entity ?? []);
}

function processFeedEntities(
  entities: GtfsRealtimeBindings.transit_realtime.IFeedEntity[],
): void {
  const vehicles = getVehicles();
  const trips = getTrips();
  const routes = getRoutes();
  const seenVehicleIds = new Set<string>();
  let vehiclePositionCount = 0;
  let interpolatedCount = 0;
  const now = Date.now();

  for (const entity of entities) {
    if (entity.tripUpdate) {
      const v = processTripUpdate(entity.tripUpdate, trips, now);
      if (v) {
        vehicles.set(v.id, v);
        seenVehicleIds.add(v.id);
        interpolatedCount++;
      }
    }
    if (entity.vehicle) {
      const v = processVehiclePosition(entity.vehicle, trips, routes);
      if (v) {
        vehicles.set(v.id, v);
        seenVehicleIds.add(v.id);
        vehiclePositionCount++;
      }
    }
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

  const delay = extractDelay(tu);
  const position = interpolateVehiclePosition(tripId, delay, nowMs);
  if (!position) return null;

  const vehicleId = tu.vehicle?.id ?? `tu-${tripId}`;

  const currentStopSequence = tu.stopTimeUpdate?.[0]?.stopSequence ?? 0;

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
  };
}

function extractDelay(
  tu: GtfsRealtimeBindings.transit_realtime.ITripUpdate,
): number {
  if (tu.delay != null) return tu.delay;
  const updates = tu.stopTimeUpdate ?? [];
  const last = updates[updates.length - 1];
  if (last?.arrival?.delay != null) return last.arrival.delay;
  if (last?.departure?.delay != null) return last.departure.delay;
  return 0;
}

function processVehiclePosition(
  vp: GtfsRealtimeBindings.transit_realtime.IVehiclePosition,
  trips: Map<string, { routeId: string }>,
  routes: Map<string, unknown>,
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
    timestamp: toNumber(vp.timestamp) || Date.now() / 1000,
  };
}

function removeStaleVehicles(
  vehicles: Map<string, Vehicle>,
  seenIds: Set<string>,
): void {
  if (seenIds.size === 0) return;
  const cutoff = Date.now() / 1000 - 300;
  for (const [id, v] of vehicles) {
    if (!seenIds.has(id) && v.timestamp < cutoff) {
      vehicles.delete(id);
    }
  }
}

function updateRouteStats(): void {
  const routes = getRoutes();
  const vehicles = getVehicles();

  const countByRoute = new Map<string, { count: number; totalDelay: number }>();
  for (const v of vehicles.values()) {
    const entry = countByRoute.get(v.routeId) ?? { count: 0, totalDelay: 0 };
    entry.count++;
    entry.totalDelay += v.delay;
    countByRoute.set(v.routeId, entry);
  }

  for (const [routeId, route] of routes) {
    const stats = countByRoute.get(routeId);
    route.vehicleCount = stats?.count ?? 0;
    route.avgDelay = stats ? Math.round(stats.totalDelay / stats.count) : 0;
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

type Long = { toNumber: () => number };
