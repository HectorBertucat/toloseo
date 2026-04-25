import { pointAtDistance } from "../utils/geo.js";
import { parseGtfsTime, getCurrentServiceDate } from "../utils/time.js";
import {
  getShapeGeometries,
  getStopDistByTrip,
  getStopTimes,
  getTrips,
  type StopTimeEntry,
  type PredictedStop,
} from "./store.js";

interface InterpolatedPosition {
  lat: number;
  lon: number;
  bearing: number;
}

/**
 * Best-effort current position for a vehicle on its trip, on the actual
 * shape geometry.
 *
 * Key idea: work in "distance along shape" (meters) rather than "fraction
 * of stops". The per-stop distance cache (built at GTFS load time) tells
 * us where each stop sits on the shape — unevenly — so interpolating
 * between two stops produces a position that matches reality instead of
 * the old "assume stops are evenly spaced" approximation.
 *
 * Strategy, in order of preference:
 *   1. If we have RT stopTimeUpdate predictions, find the two consecutive
 *      stops whose (predictedDeparture, nextPredictedArrival) span `now`,
 *      then linearly interpolate the meters-along-shape between them.
 *   2. Static fallback: the same walk using scheduled departure/arrival
 *      times, shifted by the trip-wide reported `delay`.
 *   3. Returns null when neither path can produce a position (no shape,
 *      no stops, or trip hasn't started / has ended with no data).
 */
export function interpolateVehiclePosition(
  tripId: string,
  delay: number,
  nowMs: number,
  predictions?: PredictedStop[] | null,
): InterpolatedPosition | null {
  const trip = getTrips().get(tripId);
  if (!trip) return null;

  const geom = getShapeGeometries().get(trip.shapeId);
  if (!geom || geom.line.length === 0) return null;

  const times = getStopTimes().get(tripId);
  if (!times || times.length < 2) return null;

  const stopDist = getStopDistByTrip().get(tripId);
  if (!stopDist || stopDist.length !== times.length) return null;

  // Path 1: use RT predictions per stop
  if (predictions && predictions.length > 0) {
    const distance = distanceFromPredictions(times, stopDist, predictions, nowMs);
    if (distance !== null) {
      return pointAtDistance(geom.line, geom.cumDist, distance);
    }
  }

  // Path 2: static schedule + delay
  const distance = distanceFromStatic(times, stopDist, delay, nowMs);
  if (distance === null) return null;
  return pointAtDistance(geom.line, geom.cumDist, distance);
}

/**
 * Locate the segment [stop N → stop N+1] whose predicted [departureN,
 * arrivalN+1] window contains `now`, then interpolate the distance along
 * the shape using actual per-stop distances.
 */
function distanceFromPredictions(
  staticTimes: StopTimeEntry[],
  stopDist: number[],
  predictions: PredictedStop[],
  nowMs: number,
): number | null {
  const nowSec = Math.floor(nowMs / 1000);

  // Index predictions by stopSequence for quick lookup
  const predBySeq = new Map<number, PredictedStop>();
  for (const p of predictions) {
    predBySeq.set(p.stopSequence, p);
  }

  for (let i = 0; i < staticTimes.length - 1; i++) {
    const a = staticTimes[i]!;
    const b = staticTimes[i + 1]!;
    const pa = predBySeq.get(a.stopSequence);
    const pb = predBySeq.get(b.stopSequence);

    const departureA = pickTime(pa?.departure, pa?.arrival);
    const arrivalB = pickTime(pb?.arrival, pb?.departure);

    if (!departureA || !arrivalB) continue;
    if (departureA >= arrivalB) continue;

    const distA = stopDist[i] ?? 0;
    const distB = stopDist[i + 1] ?? distA;

    if (nowSec >= departureA && nowSec <= arrivalB) {
      const segLocalFrac =
        (nowSec - departureA) / Math.max(1, arrivalB - departureA);
      return distA + (distB - distA) * segLocalFrac;
    }

    // Vehicle hasn't reached this segment yet — sit at the previous stop.
    if (nowSec < departureA) {
      return distA;
    }
  }

  // Past the last predicted stop — pin to trip end.
  return stopDist[stopDist.length - 1] ?? null;
}

/**
 * Static-schedule fallback: walk scheduled stop times, offset each by
 * the trip-wide delay, and interpolate distance in the segment that
 * contains `now`. Matches the shape of the RT path so behaviour is
 * consistent when predictions are missing.
 */
function distanceFromStatic(
  staticTimes: StopTimeEntry[],
  stopDist: number[],
  delay: number,
  nowMs: number,
): number | null {
  const serviceDate = getCurrentServiceDate();
  const nowSec = Math.floor(nowMs / 1000);

  for (let i = 0; i < staticTimes.length - 1; i++) {
    const a = staticTimes[i]!;
    const b = staticTimes[i + 1]!;
    const tA =
      parseGtfsTime(a.departureTime || a.arrivalTime, serviceDate) / 1000 +
      delay;
    const tB =
      parseGtfsTime(b.arrivalTime || b.departureTime, serviceDate) / 1000 +
      delay;

    if (!Number.isFinite(tA) || !Number.isFinite(tB)) continue;
    if (tB <= tA) continue;

    const distA = stopDist[i] ?? 0;
    const distB = stopDist[i + 1] ?? distA;

    if (nowSec >= tA && nowSec <= tB) {
      const frac = (nowSec - tA) / Math.max(1, tB - tA);
      return distA + (distB - distA) * frac;
    }
    if (nowSec < tA) {
      return distA;
    }
  }

  // Past the last scheduled stop.
  const last = staticTimes[staticTimes.length - 1];
  if (!last) return null;
  const tLast =
    parseGtfsTime(last.arrivalTime || last.departureTime, serviceDate) /
      1000 +
    delay;
  if (nowSec < tLast) return stopDist[0] ?? 0;
  return stopDist[stopDist.length - 1] ?? null;
}

function pickTime(first: number | undefined, fallback: number | undefined): number {
  if (first && first > 0) return first;
  if (fallback && fallback > 0) return fallback;
  return 0;
}
