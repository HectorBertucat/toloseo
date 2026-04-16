import {
  type Component,
  createEffect,
  createResource,
  onCleanup,
  untrack,
} from "solid-js";
import maplibregl from "maplibre-gl";
import {
  selectedVehicle,
  setSelectedVehicle,
  followedVehicle,
  setFollowedVehicle,
} from "../../stores/ui";
import { transitState } from "../../stores/transit";
import { getVehicleNextStops } from "../../services/api";
import {
  formatCountdown,
  formatTime,
  formatDelayDelta,
} from "../../utils/format";
import type { Vehicle, NextStopInfo } from "@shared/types";

interface VehiclePopupProps {
  map: maplibregl.Map;
}

const VehiclePopup: Component<VehiclePopupProps> = (props) => {
  let activePopup: maplibregl.Popup | null = null;
  let currentVehicleId: string | null = null;

  const [nextStops] = createResource(
    selectedVehicle,
    async (id): Promise<NextStopInfo[]> => {
      if (!id) return [];
      try {
        return await getVehicleNextStops(id);
      } catch {
        return [];
      }
    },
  );

  function buildHTML(v: Vehicle, upcoming: NextStopInfo[]): string {
    const line = transitState.lines.find((l) => l.id === v.routeId);
    const lineLabel = line?.shortName ?? "?";
    const bg = line?.color ?? "#6c63ff";
    const fg = line?.textColor ?? "#ffffff";
    const delta = formatDelayDelta(v.delay);
    const deltaClass =
      v.delay >= 0
        ? "vehicle-popup__delta vehicle-popup__delta--late"
        : "vehicle-popup__delta vehicle-popup__delta--early";
    const isFollowed = followedVehicle() === v.id;
    const followLabel = isFollowed ? "Arreter le suivi" : "Suivre ce vehicule";
    const headsign = upcoming[upcoming.length - 1]?.stopName ?? line?.longName ?? "";

    const nextStopsHtml = upcoming.length
      ? renderNextStops(upcoming)
      : `<p class="vehicle-popup__loading">Chargement des prochains arrets…</p>`;

    return `
      <div class="vehicle-popup">
        <div class="vehicle-popup__header">
          <span class="vehicle-popup__badge vehicle-popup__badge--xl" style="background:${escapeHtml(bg)};color:${escapeHtml(fg)}">${escapeHtml(lineLabel)}</span>
          <div class="vehicle-popup__header-main">
            <span class="vehicle-popup__direction">${escapeHtml(headsign)}</span>
            ${delta ? `<span class="${deltaClass}">${escapeHtml(delta)}</span>` : `<span class="vehicle-popup__on-time">a l'heure</span>`}
          </div>
        </div>
        <div class="vehicle-popup__section">
          <h4 class="vehicle-popup__section-title">Prochains arrets</h4>
          ${nextStopsHtml}
        </div>
        <button class="vehicle-popup__follow" data-follow="${escapeHtml(v.id)}">
          ${escapeHtml(followLabel)}
        </button>
      </div>
    `;
  }

  function renderNextStops(stops: NextStopInfo[]): string {
    const now = Date.now();
    let html = `<ul class="vehicle-popup__stops">`;
    for (const s of stops.slice(0, 5)) {
      const arrival = s.estimatedArrival || s.scheduledArrival;
      const countdown = arrival > 0 ? formatCountdown(arrival, now) : "—";
      const scheduled = s.scheduledArrival ? formatTime(s.scheduledArrival) : "";
      const delta = formatDelayDelta(s.delay);
      const deltaClass =
        s.delay >= 0
          ? "vehicle-popup__delta vehicle-popup__delta--late"
          : "vehicle-popup__delta vehicle-popup__delta--early";
      html += `<li class="vehicle-popup__stop">`;
      html += `<span class="vehicle-popup__stop-name">${escapeHtml(s.stopName)}</span>`;
      html += `<span class="vehicle-popup__stop-times">`;
      html += `<span class="vehicle-popup__stop-countdown">${escapeHtml(countdown)}</span>`;
      if (delta) {
        html += `<span class="${deltaClass}">${escapeHtml(delta)}</span>`;
        if (scheduled) {
          html += `<span class="vehicle-popup__stop-scheduled">${escapeHtml(scheduled)}</span>`;
        }
      }
      html += `</span>`;
      html += `</li>`;
    }
    html += `</ul>`;
    return html;
  }

  function bindPopupActions(popup: maplibregl.Popup): void {
    const el = popup.getElement();
    if (!el) return;
    const btn = el.querySelector<HTMLButtonElement>(".vehicle-popup__follow");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const id = btn.dataset["follow"];
      if (!id) return;
      if (followedVehicle() === id) {
        setFollowedVehicle(null);
      } else {
        setFollowedVehicle(id);
      }
    });
  }

  function closePopup(): void {
    if (activePopup) {
      activePopup.remove();
      activePopup = null;
    }
    currentVehicleId = null;
  }

  // Create popup when a vehicle is selected
  createEffect(() => {
    const vehicleId = selectedVehicle();

    if (vehicleId === currentVehicleId) return;

    if (!vehicleId) {
      closePopup();
      return;
    }

    const vehicle = transitState.vehicles[vehicleId];
    if (!vehicle) return;

    closePopup();
    currentVehicleId = vehicleId;

    const html = untrack(() => buildHTML(vehicle, nextStops() ?? []));

    const popup = new maplibregl.Popup({
      closeOnClick: false,
      closeButton: true,
      maxWidth: "300px",
      className: "toloseo-popup",
      offset: 14,
    })
      .setLngLat([vehicle.lon, vehicle.lat])
      .setHTML(html)
      .addTo(props.map);

    popup.on("close", () => {
      if (currentVehicleId === vehicleId) {
        currentVehicleId = null;
        activePopup = null;
        setSelectedVehicle(null);
      }
    });

    bindPopupActions(popup);
    activePopup = popup;
  });

  // Update popup position + content when the vehicle moves (SSE updates)
  // Also re-center map if we are following this vehicle.
  createEffect(() => {
    const id = currentVehicleId;
    const follow = followedVehicle();
    if (!id) return;
    const v = transitState.vehicles[id];
    if (!v) return;

    if (activePopup) {
      activePopup.setLngLat([v.lon, v.lat]);
      activePopup.setHTML(buildHTML(v, nextStops() ?? []));
      bindPopupActions(activePopup);
    }

    if (follow === id) {
      props.map.easeTo({
        center: [v.lon, v.lat],
        duration: 600,
      });
    }
  });

  onCleanup(() => closePopup());

  return null;
};

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

export default VehiclePopup;
