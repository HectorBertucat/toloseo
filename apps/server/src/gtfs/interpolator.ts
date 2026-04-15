import { interpolateOnLine } from "../utils/geo.js";
import { parseGtfsTime, getCurrentServiceDate } from "../utils/time.js";
import { getShapes, getStopTimes, getTrips } from "./store.js";
import type { StopTimeEntry } from "./store.js";

interface InterpolatedPosition {
  lat: number;
  lon: number;
  bearing: number;
}

export function interpolateVehiclePosition(
  tripId: string,
  delay: number,
  nowMs: number,
): InterpolatedPosition | null {
  const trip = getTrips().get(tripId);
  if (!trip) return null;

  const shape = getShapes().get(trip.shapeId);
  if (!shape || shape.coordinates.length === 0) return null;

  const times = getStopTimes().get(tripId);
  if (!times || times.length < 2) return null;

  const fraction = computeTripFraction(times, delay, nowMs);
  if (fraction === null) return null;

  const latLonLine = shape.coordinates.map(
    (c): [number, number] => [c[1] ?? 0, c[0] ?? 0],
  );

  return interpolateOnLine(latLonLine, fraction);
}

function computeTripFraction(
  stopTimes: StopTimeEntry[],
  delay: number,
  nowMs: number,
): number | null {
  const serviceDate = getCurrentServiceDate();
  const first = stopTimes[0];
  const last = stopTimes[stopTimes.length - 1];
  if (!first || !last) return null;

  const tripStart = parseGtfsTime(first.departureTime, serviceDate);
  const tripEnd = parseGtfsTime(last.arrivalTime, serviceDate);
  const duration = tripEnd - tripStart;
  if (duration <= 0) return null;

  const adjustedNow = nowMs - delay * 1000;
  const elapsed = adjustedNow - tripStart;

  if (elapsed < 0) return 0;
  if (elapsed > duration) return 1;

  return elapsed / duration;
}
