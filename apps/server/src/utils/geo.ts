import type { BBox } from "@shared/types.js";

const DEG_TO_RAD = Math.PI / 180;
const EARTH_RADIUS_M = 6_371_000;

export function isInBbox(lat: number, lon: number, bbox: BBox): boolean {
  return (
    lon >= bbox.minLon &&
    lon <= bbox.maxLon &&
    lat >= bbox.minLat &&
    lat <= bbox.maxLat
  );
}

export function distanceBetween(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG_TO_RAD) *
      Math.cos(lat2 * DEG_TO_RAD) *
      Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function bearingBetween(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const r1 = lat1 * DEG_TO_RAD;
  const r2 = lat2 * DEG_TO_RAD;
  const y = Math.sin(dLon) * Math.cos(r2);
  const x =
    Math.cos(r1) * Math.sin(r2) -
    Math.sin(r1) * Math.cos(r2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function interpolateOnLine(
  line: [number, number][],
  fraction: number,
): { lat: number; lon: number; bearing: number } {
  if (line.length === 0) return { lat: 0, lon: 0, bearing: 0 };
  if (line.length === 1) {
    const pt = line[0]!;
    return { lat: pt[0], lon: pt[1], bearing: 0 };
  }

  const clamped = Math.max(0, Math.min(1, fraction));
  const totalDist = computeTotalDistance(line);
  const targetDist = totalDist * clamped;

  let accumulated = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const segDist = distanceBetween(a[0], a[1], b[0], b[1]);

    if (accumulated + segDist >= targetDist) {
      const segFrac = segDist > 0 ? (targetDist - accumulated) / segDist : 0;
      return {
        lat: a[0] + (b[0] - a[0]) * segFrac,
        lon: a[1] + (b[1] - a[1]) * segFrac,
        bearing: bearingBetween(a[0], a[1], b[0], b[1]),
      };
    }
    accumulated += segDist;
  }

  const last = line[line.length - 1]!;
  const prev = line[line.length - 2]!;
  return {
    lat: last[0],
    lon: last[1],
    bearing: bearingBetween(prev[0], prev[1], last[0], last[1]),
  };
}

function computeTotalDistance(line: [number, number][]): number {
  let total = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    total += distanceBetween(a[0], a[1], b[0], b[1]);
  }
  return total;
}

/**
 * Cumulative distance (meters) from the first vertex to each vertex of a
 * [lat, lon] polyline. cumDist[0] = 0, cumDist[n-1] = total length.
 */
export function computeCumulativeDistances(
  line: [number, number][],
): number[] {
  const cum = new Array<number>(line.length);
  cum[0] = 0;
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    acc += distanceBetween(a[0], a[1], b[0], b[1]);
    cum[i] = acc;
  }
  return cum;
}

/**
 * Resolve a [lat, lon] point (and bearing of the underlying segment) on a
 * polyline, given the distance from its start. Uses precomputed cumulative
 * distances to avoid rewalking the line on every call.
 *
 * Out-of-range distances clamp to the endpoints.
 */
export function pointAtDistance(
  line: [number, number][],
  cumDist: number[],
  distance: number,
): { lat: number; lon: number; bearing: number } {
  if (line.length === 0) return { lat: 0, lon: 0, bearing: 0 };
  if (line.length === 1) {
    const pt = line[0]!;
    return { lat: pt[0], lon: pt[1], bearing: 0 };
  }

  const total = cumDist[cumDist.length - 1] ?? 0;
  if (distance <= 0) {
    const a = line[0]!;
    const b = line[1]!;
    return { lat: a[0], lon: a[1], bearing: bearingBetween(a[0], a[1], b[0], b[1]) };
  }
  if (distance >= total) {
    const a = line[line.length - 2]!;
    const b = line[line.length - 1]!;
    return { lat: b[0], lon: b[1], bearing: bearingBetween(a[0], a[1], b[0], b[1]) };
  }

  // Binary search for the segment containing `distance`.
  let lo = 0;
  let hi = cumDist.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if ((cumDist[mid] ?? 0) <= distance) lo = mid;
    else hi = mid;
  }

  const a = line[lo]!;
  const b = line[hi]!;
  const segStart = cumDist[lo] ?? 0;
  const segEnd = cumDist[hi] ?? segStart;
  const segLen = Math.max(1e-6, segEnd - segStart);
  const t = (distance - segStart) / segLen;

  return {
    lat: a[0] + (b[0] - a[0]) * t,
    lon: a[1] + (b[1] - a[1]) * t,
    bearing: bearingBetween(a[0], a[1], b[0], b[1]),
  };
}

/**
 * Orthogonal projection of (lat, lon) onto a polyline. Returns the distance
 * from the start of the line at the projected foot. O(n). Used at GTFS load
 * time to precompute each stop's position along its trip shape when the
 * feed doesn't include `shape_dist_traveled`.
 *
 * Uses a local equirectangular approximation per-segment — accurate enough
 * for transit shapes (sub-meter error at city scale).
 */
export function projectOnLine(
  line: [number, number][],
  cumDist: number[],
  lat: number,
  lon: number,
): { distance: number; segmentIndex: number } {
  if (line.length < 2) return { distance: 0, segmentIndex: 0 };

  let bestDist = 0;
  let bestSeg = 0;
  let bestSqErr = Infinity;
  const cosLat = Math.cos(lat * DEG_TO_RAD);

  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    // Local planar coords in radians * cos(lat), scaled to meters via Earth radius.
    const ax = a[1];
    const ay = a[0];
    const bx = b[1];
    const by = b[0];
    const px = lon;
    const py = lat;

    const dx = (bx - ax) * cosLat;
    const dy = by - ay;
    const segLenSq = dx * dx + dy * dy;
    let t = 0;
    if (segLenSq > 0) {
      t = ((px - ax) * cosLat * dx + (py - ay) * dy) / segLenSq;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
    }
    const fx = (px - (ax + (bx - ax) * t)) * cosLat;
    const fy = py - (ay + (by - ay) * t);
    const sqErr = fx * fx + fy * fy;

    if (sqErr < bestSqErr) {
      bestSqErr = sqErr;
      bestSeg = i;
      const segStart = cumDist[i] ?? 0;
      const segEnd = cumDist[i + 1] ?? segStart;
      bestDist = segStart + (segEnd - segStart) * t;
    }
  }

  return { distance: bestDist, segmentIndex: bestSeg };
}

export function parseBbox(raw: string): BBox | null {
  const parts = raw.split(",").map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return null;
  return {
    minLon: parts[0]!,
    minLat: parts[1]!,
    maxLon: parts[2]!,
    maxLat: parts[3]!,
  };
}
