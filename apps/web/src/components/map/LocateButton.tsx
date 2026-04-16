import {
  type Component,
  createSignal,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import type maplibregl from "maplibre-gl";
import "../../styles/components/locate-button.css";

interface LocateButtonProps {
  map: maplibregl.Map;
}

const SOURCE_ID = "user-location-source";
const DOT_LAYER_ID = "user-location-dot";
const HALO_LAYER_ID = "user-location-halo";

type Status = "idle" | "locating" | "tracking" | "denied";

const LocateButton: Component<LocateButtonProps> = (props) => {
  const [status, setStatus] = createSignal<Status>("idle");
  let watchId: number | null = null;
  let firstFix = true;

  function ensureLayers(): void {
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
        "circle-radius": 18,
        "circle-color": "#3b82f6",
        "circle-opacity": 0.2,
        "circle-blur": 0.5,
      },
    });
    map.addLayer({
      id: DOT_LAYER_ID,
      type: "circle",
      source: SOURCE_ID,
      paint: {
        "circle-radius": 7,
        "circle-color": "#3b82f6",
        "circle-stroke-width": 3,
        "circle-stroke-color": "#ffffff",
      },
    });
  }

  function updatePosition(lat: number, lon: number): void {
    ensureLayers();
    const src = props.map.getSource(SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    src?.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [lon, lat] },
          properties: {},
        },
      ],
    });
  }

  function stopTracking(): void {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    setStatus("idle");
    firstFix = true;
  }

  function startTracking(): void {
    if (!("geolocation" in navigator)) {
      setStatus("denied");
      return;
    }
    setStatus("locating");
    firstFix = true;
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        updatePosition(latitude, longitude);
        if (firstFix) {
          firstFix = false;
          props.map.easeTo({
            center: [longitude, latitude],
            zoom: Math.max(props.map.getZoom(), 15),
            duration: 700,
          });
        } else {
          props.map.easeTo({
            center: [longitude, latitude],
            duration: 500,
          });
        }
        setStatus("tracking");
      },
      () => {
        setStatus("denied");
        if (watchId !== null) {
          navigator.geolocation.clearWatch(watchId);
          watchId = null;
        }
      },
      { enableHighAccuracy: true, maximumAge: 5000 },
    );
  }

  function handleClick(): void {
    if (status() === "tracking" || status() === "locating") {
      stopTracking();
    } else {
      startTracking();
    }
  }

  onMount(() => {
    props.map.on("load", ensureLayers);
  });

  onCleanup(() => {
    stopTracking();
    const { map } = props;
    if (map.getLayer(DOT_LAYER_ID)) map.removeLayer(DOT_LAYER_ID);
    if (map.getLayer(HALO_LAYER_ID)) map.removeLayer(HALO_LAYER_ID);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
  });

  return (
    <div class="locate-button">
      <button
        type="button"
        class="locate-button__btn"
        classList={{
          "locate-button__btn--active": status() === "tracking",
          "locate-button__btn--locating": status() === "locating",
          "locate-button__btn--denied": status() === "denied",
        }}
        onClick={handleClick}
        aria-label={
          status() === "tracking" ? "Arreter le suivi" : "Me localiser"
        }
        title={
          status() === "tracking" ? "Arreter le suivi" : "Me localiser"
        }
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="3" />
          <circle cx="12" cy="12" r="8" />
          <line x1="12" y1="2" x2="12" y2="5" />
          <line x1="12" y1="19" x2="12" y2="22" />
          <line x1="2" y1="12" x2="5" y2="12" />
          <line x1="19" y1="12" x2="22" y2="12" />
        </svg>
      </button>
      <Show when={status() === "denied"}>
        <div class="locate-button__toast" role="status">
          Localisation refusee
        </div>
      </Show>
    </div>
  );
};

export default LocateButton;
