import type { BBox } from "@shared/types";

interface LngLatBoundsLike {
  getWest(): number;
  getSouth(): number;
  getEast(): number;
  getNorth(): number;
}

function bboxFromBounds(bounds: LngLatBoundsLike): BBox {
  return {
    minLon: bounds.getWest(),
    minLat: bounds.getSouth(),
    maxLon: bounds.getEast(),
    maxLat: bounds.getNorth(),
  };
}

function bboxToString(bbox: BBox): string {
  return `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`;
}

function bboxContains(bbox: BBox, lon: number, lat: number): boolean {
  return (
    lon >= bbox.minLon &&
    lon <= bbox.maxLon &&
    lat >= bbox.minLat &&
    lat <= bbox.maxLat
  );
}

function expandBBox(bbox: BBox, factor: number): BBox {
  const lonDelta = (bbox.maxLon - bbox.minLon) * factor;
  const latDelta = (bbox.maxLat - bbox.minLat) * factor;
  return {
    minLon: bbox.minLon - lonDelta,
    minLat: bbox.minLat - latDelta,
    maxLon: bbox.maxLon + lonDelta,
    maxLat: bbox.maxLat + latDelta,
  };
}

const TOULOUSE_BBOX: BBox = {
  minLon: 1.35,
  minLat: 43.55,
  maxLon: 1.55,
  maxLat: 43.66,
};

export {
  bboxFromBounds,
  bboxToString,
  bboxContains,
  expandBBox,
  TOULOUSE_BBOX,
};
