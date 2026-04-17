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
import { getStops } from "../../services/api";
import { setStops } from "../../stores/transit";
import { bboxFromBounds } from "../../utils/geo";
import { theme } from "../../stores/ui";
import LineSelector from "../panels/LineSelector";
import NetworkStats from "../panels/NetworkStats";
import ThemeToggle from "../ui/ThemeToggle";
import VehicleMarkers from "./VehicleMarkers";
import StopMarkers from "./StopMarkers";
import LineLayer from "./LineLayer";
import StopPopup from "./StopPopup";
import VehiclePopup from "./VehiclePopup";
import MapLegend from "./MapLegend";
import LocateButton from "./LocateButton";
import CoachMarks from "../ui/CoachMarks";
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
  const [stopsLoaded, setStopsLoaded] = createSignal(false);

  function handleMoveEnd(): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (!map) return;
      const bounds = map.getBounds();
      const bbox = bboxFromBounds(bounds);
      updateBBox(bbox);
    }, DEBOUNCE_MS);
  }

  async function loadStops(): Promise<void> {
    try {
      const stops = await getStops();
      setStops(stops);
      setStopsLoaded(true);
    } catch (err) {
      console.error("Failed to load stops:", err);
    }
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

    const isDesktop = window.innerWidth >= 768;

    if (isDesktop) {
      map.addControl(new maplibregl.NavigationControl(), "bottom-right");
    }


    map.on("load", () => {
      setMapReady(true);
      handleMoveEnd();
      loadStops();

      // Expose for debugging in dev
      if (import.meta.env.DEV) {
        (window as unknown as Record<string, unknown>).__map = map;
      }
    });

    // Ensure the MapLibre canvas matches the viewport on mobile browser
    // chrome / iOS PWA address bar changes. Throttled via rAF.
    let resizeScheduled = false;
    const scheduleResize = (): void => {
      if (resizeScheduled) return;
      resizeScheduled = true;
      requestAnimationFrame(() => {
        resizeScheduled = false;
        map?.resize();
      });
    };
    window.addEventListener("resize", scheduleResize);
    window.addEventListener("orientationchange", scheduleResize);
    window.visualViewport?.addEventListener("resize", scheduleResize);
    onCleanup(() => {
      window.removeEventListener("resize", scheduleResize);
      window.removeEventListener("orientationchange", scheduleResize);
      window.visualViewport?.removeEventListener("resize", scheduleResize);
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
          <StopMarkers map={map} ready={stopsLoaded()} />
          <LineLayer map={map} />
          <StopPopup map={map} />
          <VehiclePopup map={map} />
          <LocateButton map={map} />
        </>
      )}

      <MapLegend />
      <CoachMarks />

      <LineSelector />
      <NetworkStats />
      <div class="transit-map__theme-toggle">
        <ThemeToggle />
      </div>
    </div>
  );
};

export default TransitMap;
