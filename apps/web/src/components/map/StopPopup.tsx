import {
  type Component,
  createEffect,
  createResource,
  onCleanup,
  Show,
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

let activePopup: maplibregl.Popup | null = null;

const StopPopup: Component<StopPopupProps> = (props) => {
  const [departures, { refetch }] = createResource(
    selectedStop,
    async (stopId) => {
      if (!stopId) return [];
      return getStopDepartures(stopId);
    },
  );

  function buildPopupHTML(
    stopName: string,
    deps: DepartureInfo[] | undefined,
    loading: boolean,
  ): string {
    let html = `<div class="stop-popup">`;
    html += `<h3 class="stop-popup__title">${escapeHtml(stopName)}</h3>`;

    if (loading) {
      html += `<p class="stop-popup__loading">Chargement...</p>`;
    } else if (!deps || deps.length === 0) {
      html += `<p class="stop-popup__empty">Aucun depart</p>`;
    } else {
      html += `<ul class="stop-popup__list">`;
      for (const dep of deps.slice(0, 5)) {
        const delayText = formatDelay(dep.delay);
        html += `<li class="stop-popup__departure">`;
        html += `<span class="stop-popup__line" style="background:#${escapeHtml(dep.routeColor)}">${escapeHtml(dep.routeShortName)}</span>`;
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

  createEffect(() => {
    const stopId = selectedStop();

    if (activePopup) {
      activePopup.remove();
      activePopup = null;
    }

    if (!stopId) return;

    const stop = transitState.stops[stopId];
    if (!stop) return;

    const popup = new maplibregl.Popup({
      closeOnClick: true,
      maxWidth: "280px",
      className: "toloseo-popup",
    })
      .setLngLat([stop.lon, stop.lat])
      .setHTML(
        buildPopupHTML(stop.name, departures(), departures.loading),
      )
      .addTo(props.map);

    popup.on("close", () => {
      setSelectedStop(null);
    });

    activePopup = popup;
  });

  createEffect(() => {
    if (!activePopup || !selectedStop()) return;
    const stop = transitState.stops[selectedStop()!];
    if (!stop) return;
    activePopup.setHTML(
      buildPopupHTML(stop.name, departures(), departures.loading),
    );
  });

  onCleanup(() => {
    if (activePopup) {
      activePopup.remove();
      activePopup = null;
    }
  });

  return null;
};

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

export default StopPopup;
