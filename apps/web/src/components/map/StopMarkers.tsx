import { type Component, createEffect, onCleanup } from "solid-js";
import type maplibregl from "maplibre-gl";
import { transitState } from "../../stores/transit";
import { setSelectedStop } from "../../stores/ui";
import type { Stop } from "@shared/types";

interface StopMarkersProps {
  map: maplibregl.Map;
  ready: boolean;
}

const SOURCE_ID = "stops-source";
const CLUSTER_LAYER_ID = "stops-clusters";
const CLUSTER_COUNT_LAYER_ID = "stops-cluster-count";
const UNCLUSTERED_LAYER_ID = "stops-unclustered";

function stopsToGeoJSON(
  stops: Stop[],
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: stops.map((s) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [s.lon, s.lat] },
      properties: {
        id: s.id,
        name: s.name,
        mode: s.modes[0] ?? "bus",
      },
    })),
  };
}

function removeAll(map: maplibregl.Map): void {
  for (const id of [CLUSTER_COUNT_LAYER_ID, UNCLUSTERED_LAYER_ID, CLUSTER_LAYER_ID]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
}

function addAll(map: maplibregl.Map, stops: Stop[]): void {
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
      "circle-opacity": 0.8,
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
      "circle-radius": ["match", ["get", "mode"], "metro", 7, "tram", 6, "cable", 6, 4],
      "circle-color": "#6c63ff",
      "circle-stroke-width": 1.5,
      "circle-stroke-color": "#ffffff",
    },
  });
}

const StopMarkers: Component<StopMarkersProps> = (props) => {
  let interactionsSetup = false;

  function setupInteractions(): void {
    if (interactionsSetup) return;
    interactionsSetup = true;
    const { map } = props;

    map.on("click", UNCLUSTERED_LAYER_ID, (e) => {
      const id = e.features?.[0]?.properties?.["id"] as string | undefined;
      if (id) setSelectedStop(id);
    });

    map.on("click", CLUSTER_LAYER_ID, (e) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource;
      source.getClusterExpansionZoom(feature.properties?.["cluster_id"] as number).then((zoom) => {
        const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
        map.easeTo({ center: coords, zoom });
      });
    });

    for (const layer of [UNCLUSTERED_LAYER_ID, CLUSTER_LAYER_ID]) {
      map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
    }
  }

  function render(): void {
    const stops = Object.values(transitState.stops) as Stop[];
    if (stops.length === 0) return;

    removeAll(props.map);
    addAll(props.map, stops);
    setupInteractions();
  }

  // Render when ready prop changes to true
  createEffect(() => {
    if (props.ready) {
      render();
    }
  });

  // Re-render after style change (theme toggle)
  props.map.on("style.load", () => {
    // Small delay to ensure style is fully loaded
    setTimeout(render, 50);
  });

  onCleanup(() => removeAll(props.map));

  return null;
};

export default StopMarkers;
