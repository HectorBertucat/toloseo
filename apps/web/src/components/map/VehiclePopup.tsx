import {
  type Component,
  createEffect,
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
import { formatDelay } from "../../utils/format";
import type { Vehicle } from "@shared/types";

interface VehiclePopupProps {
  map: maplibregl.Map;
}

const VehiclePopup: Component<VehiclePopupProps> = (props) => {
  let activePopup: maplibregl.Popup | null = null;
  let currentVehicleId: string | null = null;

  function buildHTML(v: Vehicle): string {
    const line = transitState.lines.find((l) => l.id === v.routeId);
    const lineLabel = line?.shortName ?? "?";
    const lineName = line?.longName ?? "";
    const bg = line?.color ?? "#6c63ff";
    const fg = line?.textColor ?? "#ffffff";
    const delayText = formatDelay(v.delay);
    const delayClass = v.delay < 60 ? "on-time" : v.delay < 300 ? "minor" : "major";
    const isFollowed = followedVehicle() === v.id;
    const followLabel = isFollowed ? "Arreter le suivi" : "Suivre ce vehicule";

    return `
      <div class="vehicle-popup">
        <div class="vehicle-popup__header">
          <span class="vehicle-popup__badge" style="background:${escapeHtml(bg)};color:${escapeHtml(fg)}">${escapeHtml(lineLabel)}</span>
          <span class="vehicle-popup__direction">${escapeHtml(lineName)}</span>
        </div>
        <div class="vehicle-popup__row">
          <span class="vehicle-popup__label">Retard</span>
          <span class="vehicle-popup__delay vehicle-popup__delay--${delayClass}">${escapeHtml(delayText)}</span>
        </div>
        <div class="vehicle-popup__row">
          <span class="vehicle-popup__label">Identifiant</span>
          <span class="vehicle-popup__val">${escapeHtml(v.label || v.id)}</span>
        </div>
        <button class="vehicle-popup__follow" data-follow="${escapeHtml(v.id)}">
          ${escapeHtml(followLabel)}
        </button>
      </div>
    `;
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

    const html = untrack(() => buildHTML(vehicle));

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
      activePopup.setHTML(buildHTML(v));
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
