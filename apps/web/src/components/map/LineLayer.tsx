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
  const [shape] = createResource(selectedLine, async (lineId) => {
    if (!lineId) return null;
    try {
      return await getLineShape(lineId);
    } catch {
      console.warn(`Failed to load shape for line: ${lineId}`);
      return null;
    }
  });

  function getLineColor(): string {
    const lineId = selectedLine();
    if (!lineId) return "#6c63ff";
    const line = transitState.lines.find((l) => l.id === lineId);
    return line ? `#${line.color}` : "#6c63ff";
  }

  function ensureSourceAndLayer(): void {
    const { map } = props;

    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
    }

    if (!map.getLayer(LAYER_ID)) {
      map.addLayer(
        {
          id: LAYER_ID,
          type: "line",
          source: SOURCE_ID,
          layout: {
            "line-join": "round",
            "line-cap": "round",
          },
          paint: {
            "line-color": getLineColor(),
            "line-width": 4,
            "line-opacity": 0.85,
          },
        },
        "stops-clusters",
      );
    }
  }

  createEffect(() => {
    const lineShape = shape();
    ensureSourceAndLayer();

    const source = props.map.getSource(SOURCE_ID);
    if (!source || !("setData" in source)) return;

    const geoSource = source as maplibregl.GeoJSONSource;

    if (!lineShape || !selectedLine()) {
      geoSource.setData({ type: "FeatureCollection", features: [] });
      return;
    }

    geoSource.setData({
      type: "FeatureCollection",
      features: [lineShape as GeoJSON.Feature],
    });

    props.map.setPaintProperty(LAYER_ID, "line-color", getLineColor());
  });

  onCleanup(() => {
    const { map } = props;
    if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
  });

  return null;
};

export default LineLayer;
