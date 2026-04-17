import {
  type Component,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
} from "solid-js";
import type maplibregl from "maplibre-gl";
import { selectedLineIds } from "../../stores/ui";
import { transitState } from "../../stores/transit";
import { getLineShape } from "../../services/api";

interface LineLayerProps {
  map: maplibregl.Map;
}

const SOURCE_ID = "line-shape-source";
const LAYER_ID = "line-shape-layer";

interface ShapeEntry {
  id: string;
  geometry: GeoJSON.Geometry;
}

const LineLayer: Component<LineLayerProps> = (props) => {
  const [loadingFlag, setLoadingFlag] = createSignal(false);

  // Fetch ONLY shapes (stable data). Never reads transitState.lines so it
  // does not re-fire on GTFS-RT ticks (vehicleCount / avgDelay mutations).
  const [entries] = createResource<ShapeEntry[], string[]>(
    () => selectedLineIds(),
    async (ids): Promise<ShapeEntry[]> => {
      if (ids.length === 0) return [];
      setLoadingFlag(true);
      try {
        const results = await Promise.all(
          ids.map(async (id) => {
            try {
              const shape = await getLineShape(id);
              return { id, geometry: shape.geometry as GeoJSON.Geometry };
            } catch {
              return null;
            }
          }),
        );
        return results.filter((r): r is ShapeEntry => r !== null);
      } finally {
        setLoadingFlag(false);
      }
    },
    { initialValue: [] },
  );

  // Derive features with colors in a memo — colors come from the transit
  // store but this memo only re-runs when entries OR colors change; the
  // source data update is decoupled.
  const features = createMemo<GeoJSON.Feature[]>(() => {
    const list = entries() ?? [];
    return list.map((e) => {
      const line = transitState.lines.find((l) => l.id === e.id);
      const color = line?.color ?? "#e86b5c";
      return {
        type: "Feature",
        geometry: e.geometry,
        properties: { routeId: e.id, color },
      } satisfies GeoJSON.Feature;
    });
  });

  function ensureSourceLayer(): void {
    const { map } = props;
    if (map.getSource(SOURCE_ID)) return;
    map.addSource(SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    const beforeLayer = map.getLayer("stops-clusters")
      ? "stops-clusters"
      : undefined;
    map.addLayer(
      {
        id: LAYER_ID,
        type: "line",
        source: SOURCE_ID,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": 5,
          "line-opacity": 0.9,
        },
      },
      beforeLayer,
    );
  }

  function removeSourceLayer(): void {
    const { map } = props;
    if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
  }

  function pushData(fc: GeoJSON.FeatureCollection): void {
    const { map } = props;
    if (!map.isStyleLoaded()) {
      map.once("styledata", () => pushData(fc));
      return;
    }
    if (fc.features.length === 0) {
      removeSourceLayer();
      return;
    }
    ensureSourceLayer();
    const src = map.getSource(SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    src?.setData(fc);
  }

  createEffect(() => {
    const fc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: features(),
    };
    pushData(fc);
  });

  // Restore after basemap style changes (light/dark, custom style swap).
  props.map.on("style.load", () => {
    const fc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: features(),
    };
    setTimeout(() => pushData(fc), 50);
  });

  // Expose loading state on the map container via data attr so LineSelector
  // can surface a spinner without a cross-component signal bus.
  createEffect(() => {
    const el = props.map.getContainer();
    if (loadingFlag()) el.dataset["lineLoading"] = "1";
    else delete el.dataset["lineLoading"];
  });

  onCleanup(() => removeSourceLayer());

  return null;
};

export default LineLayer;
