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
  let lastData: GeoJSON.FeatureCollection | null = null;

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
  );

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

  function removeAll(): void {
    const { map } = props;
    if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
  }

  function render(data: GeoJSON.FeatureCollection): void {
    const { map } = props;
    if (!map.isStyleLoaded()) {
      // Wait for the map to stabilize after a style swap. "idle" fires once
      // every source/sprite/glyph settled, whereas "styledata" can race with
      // the addSource/addLayer below and leave the shape missing.
      map.once("idle", () => render(data));
      return;
    }
    // Fast path: source exists → just push new data, no teardown.
    const existing = map.getSource(SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (existing) {
      if (data.features.length === 0) {
        removeAll();
        return;
      }
      existing.setData(data);
      return;
    }
    // Slow path (initial render): create source + layer with data inline.
    if (data.features.length === 0) return;
    map.addSource(SOURCE_ID, { type: "geojson", data });
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

  createEffect(() => {
    const data: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: features(),
    };
    lastData = data;
    render(data);
  });

  // Re-render after the map style reloads (theme toggle, etc). Must be
  // cleaned up or MapLibre accumulates listeners across remounts.
  const onStyleLoad = (): void => {
    if (lastData) render(lastData);
  };
  props.map.on("style.load", onStyleLoad);

  // Signal loading state via data attr on map container.
  createEffect(() => {
    const el = props.map.getContainer();
    if (loadingFlag()) el.dataset["lineLoading"] = "1";
    else delete el.dataset["lineLoading"];
  });

  onCleanup(() => {
    props.map.off("style.load", onStyleLoad);
    removeAll();
  });

  return null;
};

export default LineLayer;
