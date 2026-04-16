import type { TransitLine, Stop, Vehicle, Alert, TransitMode } from "@shared/types.js";

// ── Internal types ───────────────────────────────────────────────────

export interface TripInfo {
  tripId: string;
  routeId: string;
  serviceId: string;
  shapeId: string;
  headsign: string;
  directionId: number;
}

export interface StopTimeEntry {
  stopId: string;
  arrivalTime: string;
  departureTime: string;
  stopSequence: number;
}

export interface GeoJsonLineString {
  type: "LineString";
  coordinates: [number, number][];
}

export interface ServiceCalendar {
  serviceId: string;
  days: boolean[];
  startDate: string;
  endDate: string;
}

export interface CalendarException {
  serviceId: string;
  date: string;
  exceptionType: number;
}

// ── Store maps ───────────────────────────────────────────────────────

const routes = new Map<string, TransitLine>();
const stops = new Map<string, Stop>();
const trips = new Map<string, TripInfo>();
const shapes = new Map<string, GeoJsonLineString>();
const stopTimes = new Map<string, StopTimeEntry[]>();
const vehicles = new Map<string, Vehicle>();
// Per-vehicle predicted stop times from GTFS-RT tripUpdate.stopTimeUpdate
// Only keeps future stops; updated on every poll.
export interface PredictedStop {
  stopSequence: number;
  stopId: string;
  arrival: number; // unix seconds, 0 if unknown
  departure: number; // unix seconds, 0 if unknown
}
const vehiclePredictions = new Map<string, PredictedStop[]>();
const serviceCalendars = new Map<string, ServiceCalendar>();
const calendarExceptions: CalendarException[] = [];
// Cache of "YYYY-MM-DD" -> set of active serviceIds for that date.
// Invalidated on every GTFS reload via setGtfsLoaded(true).
const activeServicesCache = new Map<string, Set<string>>();

let alerts: Alert[] = [];
let gtfsLoaded = false;
let lastPollTime = 0;
let hasVehiclePositions = false;

// ── Getters ──────────────────────────────────────────────────────────

export function getRoutes(): Map<string, TransitLine> {
  return routes;
}

export function getStops(): Map<string, Stop> {
  return stops;
}

export function getTrips(): Map<string, TripInfo> {
  return trips;
}

export function getShapes(): Map<string, GeoJsonLineString> {
  return shapes;
}

export function getStopTimes(): Map<string, StopTimeEntry[]> {
  return stopTimes;
}

export function getVehicles(): Map<string, Vehicle> {
  return vehicles;
}

export function getVehiclePredictions(): Map<string, PredictedStop[]> {
  return vehiclePredictions;
}

export function getAlerts(): Alert[] {
  return alerts;
}

export function getServiceCalendars(): Map<string, ServiceCalendar> {
  return serviceCalendars;
}

export function getCalendarExceptions(): CalendarException[] {
  return calendarExceptions;
}

export function isGtfsLoaded(): boolean {
  return gtfsLoaded;
}

export function getLastPollTime(): number {
  return lastPollTime;
}

export function getHasVehiclePositions(): boolean {
  return hasVehiclePositions;
}

// ── Setters ──────────────────────────────────────────────────────────

export function setGtfsLoaded(loaded: boolean): void {
  gtfsLoaded = loaded;
  // Calendar data may have changed, invalidate per-date cache
  activeServicesCache.clear();
}

/**
 * Return the set of service_ids active on the given date (YYYY-MM-DD),
 * combining calendar.txt (weekly pattern + validity range) and
 * calendar_dates.txt (per-date additions/removals).
 *
 * Cached per-date for the lifetime of the current GTFS dataset.
 */
export function getActiveServicesForDate(date: string): Set<string> {
  const cached = activeServicesCache.get(date);
  if (cached) return cached;

  const active = new Set<string>();
  const compact = date.replace(/-/g, ""); // YYYY-MM-DD -> YYYYMMDD
  // Day-of-week index matching our calendar.days array (0=Monday..6=Sunday)
  const jsDay = new Date(`${date}T00:00:00`).getDay(); // 0=Sunday..6=Saturday
  const dowIndex = (jsDay + 6) % 7;

  for (const cal of serviceCalendars.values()) {
    if (compact < cal.startDate || compact > cal.endDate) continue;
    if (cal.days[dowIndex]) active.add(cal.serviceId);
  }

  for (const ex of calendarExceptions) {
    if (ex.date !== compact) continue;
    if (ex.exceptionType === 1) active.add(ex.serviceId);
    else if (ex.exceptionType === 2) active.delete(ex.serviceId);
  }

  activeServicesCache.set(date, active);
  return active;
}

export function setLastPollTime(time: number): void {
  lastPollTime = time;
}

export function setAlerts(newAlerts: Alert[]): void {
  alerts = newAlerts;
}

export function setHasVehiclePositions(has: boolean): void {
  hasVehiclePositions = has;
}

// ── Helpers ──────────────────────────────────────────────────────────

export function inferMode(routeType: number, shortName: string): TransitMode {
  if (routeType === 0 || routeType === 12) return "tram";
  if (routeType === 1) return "metro";
  if (routeType === 5 || routeType === 6) return "cable";
  const lower = shortName.toLowerCase();
  if (lower === "a" || lower === "b") return "metro";
  if (lower.startsWith("t")) return "tram";
  return "bus";
}
