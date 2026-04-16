import { type Component, createEffect, onCleanup } from "solid-js";
import type maplibregl from "maplibre-gl";
import { transitState } from "../../stores/transit";
import { selectedLineIds, setSelectedVehicle } from "../../stores/ui";
import { delayColor } from "../../utils/format";
import type { Vehicle } from "@shared/types";

interface VehicleMarkersProps {
  map: maplibregl.Map;
}

const SOURCE_ID = "vehicles-source";
const CIRCLE_LAYER_ID = "vehicles-circle";
const HALO_LAYER_ID = "vehicles-halo";
const CHEVRON_LAYER_ID = "vehicles-chevron";
const CHEVRON_IMAGE_ID = "toloseo-chevron";

/** How long (ms) to smoothly animate from the previous position to the new one. */
const ANIMATION_DURATION_MS = 2000;

interface VehicleProps {
  id: string;
  routeId: string;
  bearing: number;
  delay: number;
  color: string;
  haloColor: string;
  selected: number;
  [key: string]: unknown;
}

interface AnimatedVehicle {
  id: string;
  routeId: string;
  bearing: number;
  delay: number;
  color: string;
  haloColor: string;
  selected: boolean;
  // Smooth position interpolation between server updates
  prevLat: number;
  prevLon: number;
  targetLat: number;
  targetLon: number;
  updatedAt: number;
}

function buildFeature(anim: AnimatedVehicle, nowMs: number): GeoJSON.Feature<GeoJSON.Point, VehicleProps> {
  const t = Math.min(1, (nowMs - anim.updatedAt) / ANIMATION_DURATION_MS);
  const eased = easeOutCubic(t);
  const lat = anim.prevLat + (anim.targetLat - anim.prevLat) * eased;
  const lon = anim.prevLon + (anim.targetLon - anim.prevLon) * eased;

  // Fallback bearing from movement vector when the feed reports 0
  let bearing = anim.bearing;
  if (!bearing) {
    const dLat = anim.targetLat - anim.prevLat;
    const dLon = anim.targetLon - anim.prevLon;
    if (Math.abs(dLat) + Math.abs(dLon) > 1e-6) {
      bearing = (Math.atan2(dLon, dLat) * 180) / Math.PI;
    }
  }

  return {
    type: "Feature",
    id: anim.id,
    geometry: { type: "Point", coordinates: [lon, lat] },
    properties: {
      id: anim.id,
      routeId: anim.routeId,
      bearing,
      delay: anim.delay,
      color: anim.color,
      haloColor: anim.haloColor,
      selected: anim.selected ? 1 : 0,
    },
  };
}

function ensureChevronImage(map: maplibregl.Map): void {
  if (map.hasImage(CHEVRON_IMAGE_ID)) return;

  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1.5;

  const cx = size / 2;
  const cy = size / 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 9);
  ctx.lineTo(cx + 7, cy + 6);
  ctx.lineTo(cx, cy + 2);
  ctx.lineTo(cx - 7, cy + 6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const image = ctx.getImageData(0, 0, size, size);
  map.addImage(
    CHEVRON_IMAGE_ID,
    { width: size, height: size, data: new Uint8Array(image.data.buffer) },
    { pixelRatio: 2 },
  );
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function addSourceAndLayers(map: maplibregl.Map): void {
  if (map.getSource(SOURCE_ID)) return;

  ensureChevronImage(map);

  map.addSource(SOURCE_ID, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  map.addLayer({
    id: HALO_LAYER_ID,
    type: "circle",
    source: SOURCE_ID,
    paint: {
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        11, ["case", ["==", ["get", "selected"], 1], 12, 7],
        14, ["case", ["==", ["get", "selected"], 1], 14, 9],
        17, ["case", ["==", ["get", "selected"], 1], 18, 12],
      ],
      "circle-color": ["get", "haloColor"],
      "circle-opacity": [
        "case",
        ["==", ["get", "selected"], 1], 0.35,
        0.1,
      ],
      "circle-blur": 0.6,
    },
  });

  map.addLayer({
    id: CIRCLE_LAYER_ID,
    type: "circle",
    source: SOURCE_ID,
    paint: {
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        11, ["case", ["==", ["get", "selected"], 1], 6, 3.5],
        14, ["case", ["==", ["get", "selected"], 1], 8, 5],
        17, ["case", ["==", ["get", "selected"], 1], 11, 9],
      ],
      "circle-color": ["get", "color"],
      "circle-stroke-width": ["case", ["==", ["get", "selected"], 1], 2, 1],
      "circle-stroke-color": "#ffffff",
      "circle-opacity": [
        "case",
        ["==", ["get", "selected"], 1], 1,
        0.35,
      ],
      "circle-stroke-opacity": [
        "case",
        ["==", ["get", "selected"], 1], 1,
        0.3,
      ],
    },
  });

  map.addLayer({
    id: CHEVRON_LAYER_ID,
    type: "symbol",
    source: SOURCE_ID,
    filter: ["!=", ["get", "bearing"], 0],
    layout: {
      "icon-image": CHEVRON_IMAGE_ID,
      "icon-rotate": ["get", "bearing"],
      "icon-rotation-alignment": "map",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-size": [
        "interpolate",
        ["linear"],
        ["zoom"],
        11, ["case", ["==", ["get", "selected"], 1], 0.35, 0.22],
        14, ["case", ["==", ["get", "selected"], 1], 0.45, 0.3],
        17, ["case", ["==", ["get", "selected"], 1], 0.65, 0.5],
      ],
    },
    paint: {
      "icon-opacity": [
        "case",
        ["==", ["get", "selected"], 1], 1,
        0.8,
      ],
    },
  });
}

const VehicleMarkers: Component<VehicleMarkersProps> = (props) => {
  let interactionsSetup = false;
  const animations = new Map<string, AnimatedVehicle>();
  let rafId: number | null = null;

  function setupInteractions(): void {
    if (interactionsSetup) return;
    interactionsSetup = true;
    const { map } = props;

    map.on("click", CIRCLE_LAYER_ID, (e) => {
      const id = e.features?.[0]?.properties?.["id"] as string | undefined;
      if (id) setSelectedVehicle(id);
    });

    map.on("mouseenter", CIRCLE_LAYER_ID, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", CIRCLE_LAYER_ID, () => {
      map.getCanvas().style.cursor = "";
    });
  }

  function syncAnimationsFromStore(): void {
    const vehicles = Object.values(transitState.vehicles) as Vehicle[];
    const selectedIds = new Set(selectedLineIds());
    const colorMap = new Map<string, string>();
    for (const line of transitState.lines) {
      colorMap.set(line.id, line.color);
    }

    const seen = new Set<string>();
    const nowMs = performance.now();

    for (const v of vehicles) {
      seen.add(v.id);
      const existing = animations.get(v.id);
      const routeColor = colorMap.get(v.routeId) ?? "#6c63ff";
      const haloColor = delayColor(v.delay);
      const selected = selectedIds.size === 0 || selectedIds.has(v.routeId);

      if (!existing) {
        // New vehicle: no animation on first appearance
        animations.set(v.id, {
          id: v.id,
          routeId: v.routeId,
          bearing: v.bearing,
          delay: v.delay,
          color: routeColor,
          haloColor,
          selected,
          prevLat: v.lat,
          prevLon: v.lon,
          targetLat: v.lat,
          targetLon: v.lon,
          updatedAt: nowMs,
        });
        continue;
      }

      // Did position change?
      if (existing.targetLat !== v.lat || existing.targetLon !== v.lon) {
        // Start a new animation from the CURRENT animated position
        const t = Math.min(1, (nowMs - existing.updatedAt) / ANIMATION_DURATION_MS);
        const eased = easeOutCubic(t);
        const currentLat = existing.prevLat + (existing.targetLat - existing.prevLat) * eased;
        const currentLon = existing.prevLon + (existing.targetLon - existing.prevLon) * eased;

        existing.prevLat = currentLat;
        existing.prevLon = currentLon;
        existing.targetLat = v.lat;
        existing.targetLon = v.lon;
        existing.updatedAt = nowMs;
      }

      // Always keep style properties current
      existing.routeId = v.routeId;
      existing.bearing = v.bearing;
      existing.delay = v.delay;
      existing.color = routeColor;
      existing.haloColor = haloColor;
      existing.selected = selected;
    }

    // Remove vehicles no longer in the store
    for (const id of animations.keys()) {
      if (!seen.has(id)) animations.delete(id);
    }
  }

  function renderFrame(): void {
    const { map } = props;
    if (!map.getSource(SOURCE_ID)) {
      addSourceAndLayers(map);
      setupInteractions();
    }

    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    const nowMs = performance.now();
    const features: GeoJSON.Feature<GeoJSON.Point, VehicleProps>[] = [];
    for (const anim of animations.values()) {
      features.push(buildFeature(anim, nowMs));
    }

    source.setData({ type: "FeatureCollection", features });
  }

  function startAnimationLoop(): void {
    if (rafId !== null) return;
    const loop = (): void => {
      renderFrame();
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
  }

  function stopAnimationLoop(): void {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  // React to store updates
  createEffect(() => {
    // Track reactive deps
    void transitState.vehicles;
    void transitState.lines;
    void selectedLineIds();
    syncAnimationsFromStore();
  });

  props.map.on("style.load", () => {
    setTimeout(() => {
      addSourceAndLayers(props.map);
      setupInteractions();
    }, 50);
  });

  // Start render loop
  startAnimationLoop();

  onCleanup(() => {
    stopAnimationLoop();
    const { map } = props;
    if (map.getLayer(CHEVRON_LAYER_ID)) map.removeLayer(CHEVRON_LAYER_ID);
    if (map.getLayer(HALO_LAYER_ID)) map.removeLayer(HALO_LAYER_ID);
    if (map.getLayer(CIRCLE_LAYER_ID)) map.removeLayer(CIRCLE_LAYER_ID);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    if (map.hasImage(CHEVRON_IMAGE_ID)) map.removeImage(CHEVRON_IMAGE_ID);
  });

  return null;
};

export default VehicleMarkers;
