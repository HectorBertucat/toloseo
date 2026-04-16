import {
  type Component,
  createEffect,
  createResource,
  onCleanup,
} from "solid-js";
import maplibregl from "maplibre-gl";
import { selectedStop, setSelectedStop } from "../../stores/ui";
import { transitState } from "../../stores/transit";
import { getStopDepartures } from "../../services/api";
import { formatTime, formatDelay } from "../../utils/format";
import type { DepartureInfo } from "@shared/types";

interface StopPopupProps {
  map: maplibregl.Map;
}

const StopPopup: Component<StopPopupProps> = (props) => {
  let activePopup: maplibregl.Popup | null = null;
  let currentStopId: string | null = null;

  const [departures] = createResource(
    selectedStop,
    async (stopId): Promise<DepartureInfo[]> => {
      if (!stopId) return [];
      try {
        return await getStopDepartures(stopId);
      } catch {
        return [];
      }
    },
  );

  function buildPopupHTML(
    stopName: string,
    deps: DepartureInfo[] | undefined,
    loading: boolean,
  ): string {
    let html = `<div class="stop-popup">`;
    html += `<h3 class="stop-popup__title">${escapeHtml(stopName)}</h3>`;

    if (loading && (!deps || deps.length === 0)) {
      html += `<p class="stop-popup__loading">Chargement...</p>`;
    } else if (!deps || deps.length === 0) {
      html += `<p class="stop-popup__empty">Aucun depart prevu</p>`;
    } else {
      html += `<ul class="stop-popup__list">`;
      for (const dep of deps.slice(0, 6)) {
        const delayText = formatDelay(dep.delay);
        html += `<li class="stop-popup__departure">`;
        html += `<span class="stop-popup__line" style="background:${escapeHtml(dep.routeColor)}">${escapeHtml(dep.routeShortName)}</span>`;
        html += `<span class="stop-popup__headsign">${escapeHtml(dep.tripHeadsign)}</span>`;
        html += `<span class="stop-popup__time">${formatTime(dep.estimatedTime)}</span>`;
        if (dep.delay !== 0) {
          html += `<span class="stop-popup__delay">${delayText}</span>`;
        }
        html += `</li>`;
      }
      html += `</ul>`;
    }

    html += `</div>`;
    return html;
  }

  function closePopup(): void {
    if (activePopup) {
      activePopup.remove();
      activePopup = null;
    }
    currentStopId = null;
  }

  // Create/destroy popup only when the selected stop CHANGES
  createEffect(() => {
    const stopId = selectedStop();

    if (stopId === currentStopId) return;

    if (!stopId) {
      closePopup();
      return;
    }

    const stop = transitState.stops[stopId];
    if (!stop) return;

    // Tear down previous and create new popup for the new stop
    closePopup();
    currentStopId = stopId;

    const popup = new maplibregl.Popup({
      closeOnClick: false,
      closeButton: true,
      maxWidth: "300px",
      className: "toloseo-popup",
      offset: 12,
    })
      .setLngLat([stop.lon, stop.lat])
      .setHTML(buildPopupHTML(stop.name, departures(), departures.loading))
      .addTo(props.map);

    popup.on("close", () => {
      if (currentStopId === stopId) {
        currentStopId = null;
        setSelectedStop(null);
      }
    });

    activePopup = popup;
  });

  // Update popup HTML when departures load/change (without recreating)
  createEffect(() => {
    const deps = departures();
    const loading = departures.loading;
    if (!activePopup || !currentStopId) return;
    const stop = transitState.stops[currentStopId];
    if (!stop) return;
    activePopup.setHTML(buildPopupHTML(stop.name, deps, loading));
  });

  onCleanup(() => closePopup());

  return null;
};

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

export default StopPopup;
