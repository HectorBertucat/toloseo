import { type Component, createEffect, onCleanup } from "solid-js";
import type maplibregl from "maplibre-gl";
import { getStopList } from "../../stores/transit";
import { setSelectedStop } from "../../stores/ui";
import type { Stop } from "@shared/types";

interface StopMarkersProps {
  map: maplibregl.Map;
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
      geometry: {
        type: "Point" as const,
        coordinates: [s.lon, s.lat],
      },
      properties: {
        id: s.id,
        name: s.name,
        mode: s.modes[0] ?? "bus",
        wheelchair: s.wheelchairAccessible,
      },
    })),
  };
}

function modeCircleRadius(mode: string): number {
  switch (mode) {
    case "metro":
      return 6;
    case "tram":
      return 5;
    case "cable":
      return 5;
    default:
      return 3;
  }
}

const StopMarkers: Component<StopMarkersProps> = (props) => {
  function ensureSourceAndLayers(): void {
    const { map } = props;

    if (map.getSource(SOURCE_ID)) return;

    map.addSource(SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
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
        "circle-radius": ["step", ["get", "point_count"], 15, 50, 20, 200, 25],
        "circle-opacity": 0.6,
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
      paint: {
        "text-color": "#ffffff",
      },
    });

    map.addLayer({
      id: UNCLUSTERED_LAYER_ID,
      type: "circle",
      source: SOURCE_ID,
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-radius": [
          "match",
          ["get", "mode"],
          "metro",
          6,
          "tram",
          5,
          "cable",
          5,
          3,
        ],
        "circle-color": "#6c63ff",
        "circle-stroke-width": 1,
        "circle-stroke-color": "#ffffff",
      },
    });

    map.on("click", UNCLUSTERED_LAYER_ID, (e) => {
      const feature = e.features?.[0];
      if (feature?.properties?.["id"]) {
        setSelectedStop(feature.properties["id"] as string);
      }
    });

    map.on("click", CLUSTER_LAYER_ID, (e) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const source = map.getSource(SOURCE_ID);
      if (source && "getClusterExpansionZoom" in source) {
        const clusterId = feature.properties?.["cluster_id"] as number;
        (source as maplibregl.GeoJSONSource).getClusterExpansionZoom(
          clusterId,
        ).then((zoom) => {
          const geometry = feature.geometry as GeoJSON.Point;
          map.easeTo({
            center: geometry.coordinates as [number, number],
            zoom,
          });
        });
      }
    });

    map.on("mouseenter", UNCLUSTERED_LAYER_ID, () => {
      map.getCanvas().style.cursor = "pointer";
    });

    map.on("mouseleave", UNCLUSTERED_LAYER_ID, () => {
      map.getCanvas().style.cursor = "";
    });

    map.on("mouseenter", CLUSTER_LAYER_ID, () => {
      map.getCanvas().style.cursor = "pointer";
    });

    map.on("mouseleave", CLUSTER_LAYER_ID, () => {
      map.getCanvas().style.cursor = "";
    });
  }

  createEffect(() => {
    const stops = getStopList();
    ensureSourceAndLayers();

    const source = props.map.getSource(SOURCE_ID);
    if (source && "setData" in source) {
      (source as maplibregl.GeoJSONSource).setData(stopsToGeoJSON(stops));
    }
  });

  onCleanup(() => {
    const { map } = props;
    for (const id of [
      CLUSTER_COUNT_LAYER_ID,
      CLUSTER_LAYER_ID,
      UNCLUSTERED_LAYER_ID,
    ]) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
  });

  return null;
};

export default StopMarkers;
