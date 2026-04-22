import { type Component, createEffect, createResource, onCleanup } from "solid-js";
import type maplibregl from "maplibre-gl";
import { transitState } from "../../stores/transit";
import { setSelectedStop, selectedLineIds } from "../../stores/ui";
import { getLineStops } from "../../services/api";
import type { Stop } from "@shared/types";

interface StopMarkersProps {
  map: maplibregl.Map;
  ready: boolean;
}

const SOURCE_ID = "stops-source";
const CLUSTER_LAYER_ID = "stops-clusters";
const CLUSTER_COUNT_LAYER_ID = "stops-cluster-count";
const UNCLUSTERED_LAYER_ID = "stops-unclustered";
const HIGHLIGHT_SOURCE_ID = "stops-highlight-source";
const HIGHLIGHT_LAYER_ID = "stops-highlight-layer";
const HIGHLIGHT_LABEL_LAYER_ID = "stops-highlight-labels";

interface StopFeatureProperties {
  id: string;
  name: string;
  mode: string;
  color: string;
}

const GROUP_RADIUS_M = 100;

function normalizeStopName(name: string): string {
  return name
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Deduplicates stops that share the same normalized name and sit within
 * GROUP_RADIUS_M of each other (both directions of a platform, etc.).
 * Returns one representative stop per group (center of mass).
 */
function dedupeStops(stops: Stop[]): Stop[] {
  const groups = new Map<string, Stop[]>();
  for (const s of stops) {
    const key = normalizeStopName(s.name);
    let arr = groups.get(key);
    if (!arr) {
      arr = [];
      groups.set(key, arr);
    }
    arr.push(s);
  }

  const out: Stop[] = [];
  for (const arr of groups.values()) {
    const buckets: Stop[][] = [];
    for (const s of arr) {
      const existing = buckets.find((b) => {
        const first = b[0];
        return (
          first !== undefined &&
          haversineMeters(s.lat, s.lon, first.lat, first.lon) <= GROUP_RADIUS_M
        );
      });
      if (existing) existing.push(s);
      else buckets.push([s]);
    }
    for (const bucket of buckets) {
      if (bucket.length === 1) {
        const only = bucket[0];
        if (only) out.push(only);
        continue;
      }
      const lat = bucket.reduce((sum, s) => sum + s.lat, 0) / bucket.length;
      const lon = bucket.reduce((sum, s) => sum + s.lon, 0) / bucket.length;
      const repr = bucket[0];
      if (!repr) continue;
      out.push({ ...repr, lat, lon });
    }
  }
  return out;
}

function stopsToGeoJSON(
  stops: Stop[],
): GeoJSON.FeatureCollection<GeoJSON.Point, StopFeatureProperties> {
  const deduped = dedupeStops(stops);
  return {
    type: "FeatureCollection",
    features: deduped.map((s) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [s.lon, s.lat] },
      properties: {
        id: s.id,
        name: s.name,
        mode: s.modes[0] ?? "bus",
        color: "#6c63ff",
      },
    })),
  };
}

function highlightedToGeoJSON(
  stops: Stop[],
  color: string,
): GeoJSON.FeatureCollection<GeoJSON.Point, StopFeatureProperties> {
  return {
    type: "FeatureCollection",
    features: stops.map((s) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [s.lon, s.lat] },
      properties: {
        id: s.id,
        name: s.name,
        mode: s.modes[0] ?? "bus",
        color,
      },
    })),
  };
}

function removeAllLayers(map: maplibregl.Map): void {
  for (const id of [
    HIGHLIGHT_LABEL_LAYER_ID,
    HIGHLIGHT_LAYER_ID,
    CLUSTER_COUNT_LAYER_ID,
    UNCLUSTERED_LAYER_ID,
    CLUSTER_LAYER_ID,
  ]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  for (const id of [HIGHLIGHT_SOURCE_ID, SOURCE_ID]) {
    if (map.getSource(id)) map.removeSource(id);
  }
}

function addBaseLayers(map: maplibregl.Map, stops: Stop[]): void {
  map.addSource(SOURCE_ID, {
    type: "geojson",
    data: stopsToGeoJSON(stops),
    cluster: true,
    clusterMaxZoom: 14,
    clusterRadius: 50,
  });

  map.addLayer({
    id: CLUSTER_LAYER_ID,
    type: "circle",
    source: SOURCE_ID,
    filter: ["has", "point_count"],
    paint: {
      "circle-color": "#6c63ff",
      "circle-radius": ["step", ["get", "point_count"], 18, 50, 24, 200, 30],
      "circle-opacity": 0.7,
    },
  });

  map.addLayer({
    id: CLUSTER_COUNT_LAYER_ID,
    type: "symbol",
    source: SOURCE_ID,
    filter: ["has", "point_count"],
    layout: {
      "text-field": ["get", "point_count_abbreviated"],
      "text-size": 12,
    },
    paint: { "text-color": "#ffffff" },
  });

  map.addLayer({
    id: UNCLUSTERED_LAYER_ID,
    type: "circle",
    source: SOURCE_ID,
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        11,
        ["match", ["get", "mode"], "metro", 4, "tram", 3.5, "cable", 3.5, 2],
        14,
        ["match", ["get", "mode"], "metro", 6, "tram", 5, "cable", 5, 3.5],
        17,
        ["match", ["get", "mode"], "metro", 10, "tram", 9, "cable", 9, 8],
      ],
      "circle-color": "#6c63ff",
      "circle-stroke-width": 1,
      "circle-stroke-color": "#ffffff",
      "circle-opacity": 0.85,
    },
  });
}

function addHighlightLayer(map: maplibregl.Map, stops: Stop[]): void {
  // Use the first stop's color as base, features carry per-feature color
  map.addSource(HIGHLIGHT_SOURCE_ID, {
    type: "geojson",
    data: highlightedToGeoJSON(stops, "#6c63ff"),
  });

  map.addLayer({
    id: HIGHLIGHT_LAYER_ID,
    type: "circle",
    source: HIGHLIGHT_SOURCE_ID,
    paint: {
      "circle-radius": [
        "match",
        ["get", "mode"],
        "metro", 10,
        "tram", 8,
        "cable", 8,
        7,
      ],
      "circle-color": ["get", "color"],
      "circle-stroke-width": 2.5,
      "circle-stroke-color": "#ffffff",
    },
  });

  map.addLayer({
    id: HIGHLIGHT_LABEL_LAYER_ID,
    type: "symbol",
    source: HIGHLIGHT_SOURCE_ID,
    minzoom: 13,
    layout: {
      "text-field": ["get", "name"],
      "text-size": 11,
      "text-offset": [0, 1.4],
      "text-anchor": "top",
      "text-font": ["Noto Sans Regular"],
      "text-optional": true,
      "text-allow-overlap": false,
    },
    paint: {
      "text-color": "#ffffff",
      "text-halo-color": "#000000",
      "text-halo-width": 1.5,
    },
  });
}

const StopMarkers: Component<StopMarkersProps> = (props) => {
  let baseStops: Stop[] = [];
  let interactionsSetup = false;

  // Fetch stops for currently selected lines
  const [lineStops] = createResource(
    selectedLineIds,
    async (ids): Promise<{ stops: Stop[]; color: string } | null> => {
      if (ids.length === 0) return null;
      const allStops = new Map<string, Stop>();
      let color = "#6c63ff";
      for (const id of ids) {
        try {
          const stops = await getLineStops(id);
          for (const s of stops) allStops.set(s.id, s);
          const line = transitState.lines.find((l) => l.id === id);
          if (line?.color) color = line.color;
        } catch {
          // skip failing line
        }
      }
      return { stops: Array.from(allStops.values()), color };
    },
  );

  function setupInteractions(): void {
    if (interactionsSetup) return;
    interactionsSetup = true;
    const { map } = props;

    // Global click handler that queries rendered features on every click.
    // This is resilient to layers being added/removed during re-renders.
    map.on("click", (e) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: [HIGHLIGHT_LAYER_ID, UNCLUSTERED_LAYER_ID, CLUSTER_LAYER_ID].filter(
          (id) => map.getLayer(id),
        ),
      });

      if (features.length === 0) return;
      const feature = features[0]!;
      const props_ = feature.properties ?? {};

      if (props_["cluster"]) {
        const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
        if (source) {
          source.getClusterExpansionZoom(props_["cluster_id"] as number).then((zoom) => {
            const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
            map.easeTo({ center: coords, zoom });
          });
        }
        return;
      }

      const id = props_["id"] as string | undefined;
      if (id) setSelectedStop(id);
    });

    map.on("mousemove", (e) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: [HIGHLIGHT_LAYER_ID, UNCLUSTERED_LAYER_ID, CLUSTER_LAYER_ID].filter(
          (id) => map.getLayer(id),
        ),
      });
      map.getCanvas().style.cursor = features.length > 0 ? "pointer" : "";
    });
  }

  function renderAll(): void {
    const { map } = props;
    const stops = baseStops;
    if (stops.length === 0) return;

    removeAllLayers(map);
    addBaseLayers(map, stops);

    const selected = lineStops();
    if (selected && selected.stops.length > 0) {
      addHighlightLayer(map, selected.stops);
    }

    setupInteractions();
  }

  // React to base stops loaded
  createEffect(() => {
    if (props.ready) {
      baseStops = Object.values(transitState.stops) as Stop[];
      renderAll();
    }
  });

  // React to selected lines changing (refresh highlight)
  createEffect(() => {
    const selected = lineStops();
    if (baseStops.length === 0) return;
    // Remove just the highlight layers
    const { map } = props;
    if (map.getLayer(HIGHLIGHT_LABEL_LAYER_ID)) map.removeLayer(HIGHLIGHT_LABEL_LAYER_ID);
    if (map.getLayer(HIGHLIGHT_LAYER_ID)) map.removeLayer(HIGHLIGHT_LAYER_ID);
    if (map.getSource(HIGHLIGHT_SOURCE_ID)) map.removeSource(HIGHLIGHT_SOURCE_ID);

    if (selected && selected.stops.length > 0) {
      addHighlightLayer(map, selected.stops);
    }
  });

  // Re-render after style change. Tracked as a named handler so we can detach
  // it on cleanup — MapLibre's on()/off() keep anonymous listeners forever.
  const onStyleLoad = (): void => {
    renderAll();
  };
  props.map.on("style.load", onStyleLoad);

  onCleanup(() => {
    props.map.off("style.load", onStyleLoad);
    removeAllLayers(props.map);
  });

  return null;
};

export default StopMarkers;
