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
