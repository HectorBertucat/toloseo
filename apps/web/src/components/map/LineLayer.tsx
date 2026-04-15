import { type Component, createEffect, createResource, onCleanup } from "solid-js";
import type maplibregl from "maplibre-gl";
import { selectedLine } from "../../stores/ui";
import { transitState } from "../../stores/transit";
import { getLineShape, type LineShape } from "../../services/api";

interface LineLayerProps {
  map: maplibregl.Map;
}

const SOURCE_ID = "line-shape-source";
const LAYER_ID = "line-shape-layer";

const LineLayer: Component<LineLayerProps> = (props) => {
  let lastShapeData: GeoJSON.FeatureCollection | null = null;
  let lastColor = "#6c63ff";

  const [shape] = createResource(selectedLine, async (lineId) => {
    if (!lineId) return null;
    try {
      return await getLineShape(lineId);
    } catch {
      return null;
    }
  });

  function getLineColor(): string {
    const lineId = selectedLine();
    if (!lineId) return "#6c63ff";
    const line = transitState.lines.find((l) => l.id === lineId);
    return line?.color ?? "#6c63ff";
  }

  function removeAll(): void {
    const { map } = props;
    if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
  }

  function render(shapeData: GeoJSON.FeatureCollection, color: string): void {
    const { map } = props;
    removeAll();

    map.addSource(SOURCE_ID, { type: "geojson", data: shapeData });
    const beforeLayer = map.getLayer("stops-clusters") ? "stops-clusters" : undefined;
    map.addLayer({
      id: LAYER_ID,
      type: "line",
      source: SOURCE_ID,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": color, "line-width": 5, "line-opacity": 0.85 },
    }, beforeLayer);
  }

  createEffect(() => {
    const lineShape = shape();
    const color = getLineColor();
    lastColor = color;

    if (!lineShape || !selectedLine()) {
      lastShapeData = null;
      removeAll();
      return;
    }

    lastShapeData = {
      type: "FeatureCollection",
      features: [lineShape as GeoJSON.Feature],
    };

    render(lastShapeData, color);
  });

  props.map.on("style.load", () => {
    if (lastShapeData) {
      setTimeout(() => render(lastShapeData!, lastColor), 50);
    }
  });

  onCleanup(() => removeAll());

  return null;
};

export default LineLayer;
