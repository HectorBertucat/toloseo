import { type Component, createEffect, createResource, onCleanup } from "solid-js";
import type maplibregl from "maplibre-gl";
import { selectedLineIds } from "../../stores/ui";
import { transitState } from "../../stores/transit";
import { getLineShape } from "../../services/api";

interface LineLayerProps {
  map: maplibregl.Map;
}

const SOURCE_ID = "line-shape-source";
const LAYER_ID = "line-shape-layer";

const LineLayer: Component<LineLayerProps> = (props) => {
  let lastData: GeoJSON.FeatureCollection | null = null;

  const [shapes] = createResource(
    selectedLineIds,
    async (ids): Promise<GeoJSON.Feature[]> => {
      if (ids.length === 0) return [];
      const fetches = ids.map(async (id) => {
        try {
          const shape = await getLineShape(id);
          const line = transitState.lines.find((l) => l.id === id);
          const color = line?.color ?? "#6c63ff";
          return {
            type: "Feature" as const,
            geometry: shape.geometry as GeoJSON.Geometry,
            properties: { routeId: id, color },
          } as GeoJSON.Feature;
        } catch {
          return null;
        }
      });
      const results = await Promise.all(fetches);
      return results.filter((r): r is GeoJSON.Feature => r !== null);
    },
  );

  function removeAll(): void {
    const { map } = props;
    if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
  }

  function render(data: GeoJSON.FeatureCollection): void {
    const { map } = props;
    removeAll();

    if (data.features.length === 0) return;

    map.addSource(SOURCE_ID, { type: "geojson", data });
    const beforeLayer = map.getLayer("stops-clusters") ? "stops-clusters" : undefined;
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
    const features = shapes() ?? [];
    const data: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features,
    };
    lastData = data;
    render(data);
  });

  props.map.on("style.load", () => {
    if (lastData) setTimeout(() => render(lastData!), 50);
  });

  onCleanup(() => removeAll());

  return null;
};

export default LineLayer;
