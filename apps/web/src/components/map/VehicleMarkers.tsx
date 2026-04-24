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

/** How long (ms) to smoothly animate from the previous position to the new one.
 *  Matches the server-side refine cadence so the marker reaches its new
 *  position just as the next update arrives — no rubber-banding, no pauses. */
const ANIMATION_DURATION_MS = 2000;

interface VehicleProps {
  id: string;
  routeId: string;
  bearing: number;
  delay: number;
  color: string;
  haloColor: string;
  selected: number;
  stale: number;
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
  stale: boolean;
  // Smooth position interpolation between server updates
  prevLat: number;
  prevLon: number;
  targetLat: number;
  targetLon: number;
  updatedAt: number;
}

function buildFeature(anim: AnimatedVehicle, nowMs: number): GeoJSON.Feature<GeoJSON.Point, VehicleProps> {
  const t = Math.min(1, (nowMs - anim.updatedAt) / ANIMATION_DURATION_MS);
  // Linear interpolation: real buses move at roughly constant speed between
  // two server ticks, so easing (decelerating) makes the marker lag behind
  // reality in the second half of each interval.
  const lat = anim.prevLat + (anim.targetLat - anim.prevLat) * t;
  const lon = anim.prevLon + (anim.targetLon - anim.prevLon) * t;

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
      stale: anim.stale ? 1 : 0,
    },
  };
}

function ensureChevronImage(map: maplibregl.Map): void {
  if (map.hasImage(CHEVRON_IMAGE_ID)) return;

  // Dark ink chevron with crisp white outer ring. The two-tone stroke gives
  // clear contrast against both light-terracotta and dark-night map styles,
  // so the bus direction stays readable at every zoom level.
  const size = 40;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = "#1a1216";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";

  const cx = size / 2;
  const cy = size / 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 13);
  ctx.lineTo(cx + 10, cy + 9);
  ctx.lineTo(cx, cy + 4);
  ctx.lineTo(cx - 10, cy + 9);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();

  const image = ctx.getImageData(0, 0, size, size);
  map.addImage(
    CHEVRON_IMAGE_ID,
    { width: size, height: size, data: new Uint8Array(image.data.buffer) },
    { pixelRatio: 2 },
  );
}

// Note: easeOutCubic removed. Position interpolation is now linear because
// real vehicles move at constant speed between ticks. The bearing
// smoothing (server-side EMA) and visual ring / chevron already soften
// the perceived motion.

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
        ["==", ["get", "stale"], 1], 0.25,
        ["==", ["get", "selected"], 1], 1,
        0.35,
      ],
      "circle-stroke-opacity": [
        "case",
        ["==", ["get", "stale"], 1], 0.25,
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
      // Bigger than before: chevrons were ~4-5px at city zoom and invisible.
      "icon-size": [
        "interpolate",
        ["linear"],
        ["zoom"],
        11, ["case", ["==", ["get", "selected"], 1], 0.6, 0.42],
        14, ["case", ["==", ["get", "selected"], 1], 0.75, 0.55],
        17, ["case", ["==", ["get", "selected"], 1], 1.0, 0.8],
      ],
    },
    paint: {
      "icon-opacity": [
        "case",
        ["==", ["get", "selected"], 1], 1,
        0.95,
      ],
    },
  });
}

const VehicleMarkers: Component<VehicleMarkersProps> = (props) => {
  let interactionsSetup = false;
  const animations = new Map<string, AnimatedVehicle>();
  let rafId: number | null = null;
  let animationEndsAt = 0;

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
    const stale = transitState.feedStale;

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
          stale,
          prevLat: v.lat,
          prevLon: v.lon,
          targetLat: v.lat,
          targetLon: v.lon,
          updatedAt: nowMs,
        });
        // New vehicle → schedule at least one render frame.
        animationEndsAt = Math.max(animationEndsAt, nowMs + 16);
        continue;
      }

      // Did position change?
      if (existing.targetLat !== v.lat || existing.targetLon !== v.lon) {
        // Start a new animation from the CURRENT animated position
        const t = Math.min(1, (nowMs - existing.updatedAt) / ANIMATION_DURATION_MS);
        const currentLat = existing.prevLat + (existing.targetLat - existing.prevLat) * t;
        const currentLon = existing.prevLon + (existing.targetLon - existing.prevLon) * t;

        existing.prevLat = currentLat;
        existing.prevLon = currentLon;
        existing.targetLat = v.lat;
        existing.targetLon = v.lon;
        existing.updatedAt = nowMs;
        animationEndsAt = Math.max(animationEndsAt, nowMs + ANIMATION_DURATION_MS);
      }

      // Always keep style properties current
      existing.routeId = v.routeId;
      existing.bearing = v.bearing;
      existing.delay = v.delay;
      existing.color = routeColor;
      existing.haloColor = haloColor;
      existing.selected = selected;
      existing.stale = stale;
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
    if (typeof document !== "undefined" && document.hidden) return;
    const loop = (): void => {
      renderFrame();
      // Only keep RAF alive while an animation is still interpolating. Once
      // everything has settled, stop the loop and resume on the next SSE
      // update. Saves ~60 fps of setData work when the map is idle.
      if (performance.now() < animationEndsAt) {
        rafId = requestAnimationFrame(loop);
      } else {
        rafId = null;
      }
    };
    rafId = requestAnimationFrame(loop);
  }

  function stopAnimationLoop(): void {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function onVisibilityChange(): void {
    if (document.hidden) {
      stopAnimationLoop();
    } else if (performance.now() < animationEndsAt) {
      startAnimationLoop();
    } else {
      // Force one frame so stale positions snap to their targets.
      renderFrame();
    }
  }

  function onStyleLoad(): void {
    addSourceAndLayers(props.map);
    setupInteractions();
    // Render once so existing vehicles reappear after the style swap.
    renderFrame();
  }

  // React to store updates
  createEffect(() => {
    // Track reactive deps
    void transitState.vehicles;
    void transitState.lines;
    void transitState.feedStale;
    void selectedLineIds();
    syncAnimationsFromStore();
    // Ensure at least one frame is drawn for non-positional changes (selection,
    // delay recolor, stale status), and that the RAF loop resumes if we just
    // added motion.
    if (rafId === null) startAnimationLoop();
  });

  props.map.on("style.load", onStyleLoad);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  onCleanup(() => {
    stopAnimationLoop();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
    const { map } = props;
    map.off("style.load", onStyleLoad);
    if (map.getLayer(CHEVRON_LAYER_ID)) map.removeLayer(CHEVRON_LAYER_ID);
    if (map.getLayer(HALO_LAYER_ID)) map.removeLayer(HALO_LAYER_ID);
    if (map.getLayer(CIRCLE_LAYER_ID)) map.removeLayer(CIRCLE_LAYER_ID);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    if (map.hasImage(CHEVRON_IMAGE_ID)) map.removeImage(CHEVRON_IMAGE_ID);
  });

  return null;
};

export default VehicleMarkers;
