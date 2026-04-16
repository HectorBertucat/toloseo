import { interpolateOnLine } from "../utils/geo.js";
import { parseGtfsTime, getCurrentServiceDate } from "../utils/time.js";
import {
  getShapes,
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
 * Best-effort position for a vehicle on its trip.
 *
 * Strategy, in order of preference:
 * 1. If we have RT stopTimeUpdate predictions, find the two consecutive stops
 *    whose (predictedDeparture, nextPredictedArrival) span `now`, and
 *    interpolate along the shape between those two stops.
 * 2. Otherwise fall back to the crude whole-trip linear interpolation based
 *    on static scheduled times adjusted by the reported delay.
 */
export function interpolateVehiclePosition(
  tripId: string,
  delay: number,
  nowMs: number,
  predictions?: PredictedStop[] | null,
): InterpolatedPosition | null {
  const trip = getTrips().get(tripId);
  if (!trip) return null;

  const shape = getShapes().get(trip.shapeId);
  if (!shape || shape.coordinates.length === 0) return null;

  const times = getStopTimes().get(tripId);
  if (!times || times.length < 2) return null;

  const latLonLine = shape.coordinates.map(
    (c): [number, number] => [c[1] ?? 0, c[0] ?? 0],
  );

  // Path 1: use RT predictions per stop
  if (predictions && predictions.length > 0) {
    const segmentFraction = fractionFromPredictions(times, predictions, nowMs);
    if (segmentFraction !== null) {
      return interpolateOnLine(latLonLine, segmentFraction);
    }
  }

  // Path 2: static schedule + delay
  const fraction = computeTripFractionStatic(times, delay, nowMs);
  if (fraction === null) return null;
  return interpolateOnLine(latLonLine, fraction);
}

/**
 * Finds the segment [stop N → stop N+1] that `now` falls into based on the
 * RT-predicted departure/arrival times, then returns the overall trip
 * fraction as (seqFractionInSegment weighted to whole trip).
 *
 * Stops are assumed to be evenly spaced along the shape — this is a
 * simplification but gives surprisingly good results since GTFS shapes
 * tend to sample densely near stops anyway.
 */
function fractionFromPredictions(
  staticTimes: StopTimeEntry[],
  predictions: PredictedStop[],
  nowMs: number,
): number | null {
  const nowSec = Math.floor(nowMs / 1000);
  const totalStops = staticTimes.length;
  if (totalStops < 2) return null;

  // Index predictions by stopSequence for quick lookup
  const predBySeq = new Map<number, PredictedStop>();
  for (const p of predictions) {
    predBySeq.set(p.stopSequence, p);
  }

  // Walk consecutive pairs
  for (let i = 0; i < staticTimes.length - 1; i++) {
    const a = staticTimes[i]!;
    const b = staticTimes[i + 1]!;
    const pa = predBySeq.get(a.stopSequence);
    const pb = predBySeq.get(b.stopSequence);

    const departureA = pickTime(pa?.departure, pa?.arrival);
    const arrivalB = pickTime(pb?.arrival, pb?.departure);

    if (!departureA || !arrivalB) continue;
    if (departureA >= arrivalB) continue;

    if (nowSec >= departureA && nowSec <= arrivalB) {
      const segLocalFrac =
        (nowSec - departureA) / Math.max(1, arrivalB - departureA);
      // Map segment into whole-shape fraction assuming even spacing
      const fracA = i / (totalStops - 1);
      const fracB = (i + 1) / (totalStops - 1);
      return fracA + (fracB - fracA) * segLocalFrac;
    }

    // Vehicle hasn't reached this segment yet
    if (nowSec < departureA) {
      // We are still at previous stop (or earlier)
      return i / (totalStops - 1);
    }
  }

  // Past the last predicted stop
  return 1;
}

function pickTime(first: number | undefined, fallback: number | undefined): number {
  if (first && first > 0) return first;
  if (fallback && fallback > 0) return fallback;
  return 0;
}

function computeTripFractionStatic(
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
