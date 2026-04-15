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

function bearingBetween(
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
