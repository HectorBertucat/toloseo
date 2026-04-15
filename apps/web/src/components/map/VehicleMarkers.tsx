import { type Component, createEffect, onCleanup } from "solid-js";
import type maplibregl from "maplibre-gl";
import { transitState } from "../../stores/transit";
import { delayColor } from "../../utils/format";
import type { Vehicle } from "@shared/types";

interface VehicleMarkersProps {
  map: maplibregl.Map;
}

const SOURCE_ID = "vehicles-source";
const CIRCLE_LAYER_ID = "vehicles-circle";
const HALO_LAYER_ID = "vehicles-halo";

function vehiclesToGeoJSON(
  vehicles: Vehicle[],
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: vehicles.map((v) => ({
      type: "Feature" as const,
      id: v.id,
      geometry: {
        type: "Point" as const,
        coordinates: [v.lon, v.lat],
      },
      properties: {
        id: v.id,
        routeId: v.routeId,
        label: v.label,
        bearing: v.bearing,
        delay: v.delay,
        haloColor: delayColor(v.delay),
      },
    })),
  };
}

const VehicleMarkers: Component<VehicleMarkersProps> = (props) => {
  function ensureSourceAndLayers(): void {
    const { map } = props;

    if (map.getSource(SOURCE_ID)) return;

    map.addSource(SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    map.addLayer({
      id: HALO_LAYER_ID,
      type: "circle",
      source: SOURCE_ID,
      paint: {
        "circle-radius": 10,
        "circle-color": ["get", "haloColor"],
        "circle-opacity": 0.25,
        "circle-blur": 0.5,
      },
    });

    map.addLayer({
      id: CIRCLE_LAYER_ID,
      type: "circle",
      source: SOURCE_ID,
      paint: {
        "circle-radius": 5,
        "circle-color": "#ffffff",
        "circle-stroke-width": 2,
        "circle-stroke-color": ["get", "haloColor"],
      },
    });
  }

  createEffect(() => {
    const vehiclesRecord = transitState.vehicles;
    const vehicles = Object.values(vehiclesRecord);
    ensureSourceAndLayers();

    const source = props.map.getSource(SOURCE_ID);
    if (source && "setData" in source) {
      (source as maplibregl.GeoJSONSource).setData(
        vehiclesToGeoJSON(vehicles),
      );
    }
  });

  props.map.on("style.load", () => {
    const vehicles = Object.values(transitState.vehicles);
    if (!props.map.getSource(SOURCE_ID)) {
      ensureSourceAndLayers();
      const source = props.map.getSource(SOURCE_ID);
      if (source && "setData" in source) {
        (source as maplibregl.GeoJSONSource).setData(vehiclesToGeoJSON(vehicles));
      }
    }
  });

  onCleanup(() => {
    const { map } = props;
    if (map.getLayer(HALO_LAYER_ID)) map.removeLayer(HALO_LAYER_ID);
    if (map.getLayer(CIRCLE_LAYER_ID)) map.removeLayer(CIRCLE_LAYER_ID);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
  });

  return null;
};

export default VehicleMarkers;
