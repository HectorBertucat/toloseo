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

interface VehicleProps {
  id: string;
  routeId: string;
  bearing: number;
  delay: number;
  color: string;
  haloColor: string;
  selected: number;
}

function vehiclesToGeoJSON(
  vehicles: Vehicle[],
  selectedIds: Set<string>,
  lineColorsById: Map<string, string>,
): GeoJSON.FeatureCollection<GeoJSON.Point, VehicleProps> {
  return {
    type: "FeatureCollection",
    features: vehicles.map((v) => {
      const isSelected = selectedIds.size === 0 || selectedIds.has(v.routeId);
      const routeColor = lineColorsById.get(v.routeId) ?? "#6c63ff";
      return {
        type: "Feature" as const,
        id: v.id,
        geometry: { type: "Point" as const, coordinates: [v.lon, v.lat] },
        properties: {
          id: v.id,
          routeId: v.routeId,
          bearing: v.bearing,
          delay: v.delay,
          color: routeColor,
          haloColor: delayColor(v.delay),
          selected: isSelected ? 1 : 0,
        },
      };
    }),
  };
}

function addSourceAndLayers(map: maplibregl.Map): void {
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
      "circle-radius": ["case", ["==", ["get", "selected"], 1], 14, 8],
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
      "circle-radius": ["case", ["==", ["get", "selected"], 1], 7, 4],
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
}

const VehicleMarkers: Component<VehicleMarkersProps> = (props) => {
  let interactionsSetup = false;

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

  function update(): void {
    const { map } = props;
    const vehicles = Object.values(transitState.vehicles) as Vehicle[];
    const selectedIds = new Set(selectedLineIds());
    const colorMap = new Map<string, string>();
    for (const line of transitState.lines) {
      colorMap.set(line.id, line.color);
    }

    if (!map.getSource(SOURCE_ID)) {
      addSourceAndLayers(map);
      setupInteractions();
    }

    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(vehiclesToGeoJSON(vehicles, selectedIds, colorMap));
    }
  }

  createEffect(() => {
    // Track dependencies: vehicles, lines, selection
    void transitState.vehicles;
    void transitState.lines;
    void selectedLineIds();
    update();
  });

  props.map.on("style.load", () => {
    setTimeout(update, 50);
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
