import {
  type Component,
  onMount,
  onCleanup,
  createSignal,
  createEffect,
} from "solid-js";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { connect, disconnect, updateBBox } from "../../services/sse-client";
import { bboxFromBounds } from "../../utils/geo";
import { theme } from "../../stores/ui";
import LineSelector from "../panels/LineSelector";
import NetworkStats from "../panels/NetworkStats";
import ThemeToggle from "../ui/ThemeToggle";
import VehicleMarkers from "./VehicleMarkers";
import StopMarkers from "./StopMarkers";
import LineLayer from "./LineLayer";
import StopPopup from "./StopPopup";
import "../../styles/components/map.css";

const TOULOUSE_CENTER: [number, number] = [1.4437, 43.6047];
const DEFAULT_ZOOM = 13;
const DEBOUNCE_MS = 300;

const MAP_STYLES = {
  dark: "https://tiles.openfreemap.org/styles/dark",
  light: "https://tiles.openfreemap.org/styles/positron",
} as const;

const TransitMap: Component = () => {
  let containerRef: HTMLDivElement | undefined;
  let map: maplibregl.Map | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  const [mapReady, setMapReady] = createSignal(false);

  function handleMoveEnd(): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (!map) return;
      const bounds = map.getBounds();
      const bbox = bboxFromBounds(bounds);
      updateBBox(bbox);
    }, DEBOUNCE_MS);
  }

  onMount(() => {
    if (!containerRef) return;

    map = new maplibregl.Map({
      container: containerRef,
      style: MAP_STYLES[theme()],
      center: TOULOUSE_CENTER,
      zoom: DEFAULT_ZOOM,
      minZoom: 10,
      maxZoom: 18,
      attributionControl: false,
    });

    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right",
    );

    map.addControl(new maplibregl.NavigationControl(), "bottom-right");

    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
      }),
      "bottom-right",
    );

    map.on("load", () => {
      setMapReady(true);
      handleMoveEnd();
    });

    map.on("moveend", handleMoveEnd);

    const bounds = map.getBounds();
    const bbox = bboxFromBounds(bounds);
    connect(bbox);
  });

  createEffect(() => {
    const currentTheme = theme();
    if (map && mapReady()) {
      map.setStyle(MAP_STYLES[currentTheme]);
    }
  });

  onCleanup(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    disconnect();
    map?.remove();
  });

  return (
    <div class="transit-map">
      <div ref={containerRef} class="transit-map__container" />

      {mapReady() && map && (
        <>
          <VehicleMarkers map={map} />
          <StopMarkers map={map} />
          <LineLayer map={map} />
          <StopPopup map={map} />
        </>
      )}

      <LineSelector />
      <NetworkStats />
      <div class="transit-map__theme-toggle">
        <ThemeToggle />
      </div>
    </div>
  );
};

export default TransitMap;
