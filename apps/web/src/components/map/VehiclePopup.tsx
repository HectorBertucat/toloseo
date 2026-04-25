import {
  type Component,
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
} from "solid-js";
import { Portal } from "solid-js/web";
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
import { pickReadableTextColor } from "../../utils/contrast";
import BottomSheet from "../ui/BottomSheet";
import type { Vehicle, NextStopInfo, TransitLine } from "@shared/types";

interface VehiclePopupProps {
  map: maplibregl.Map;
}

const MOBILE_BREAKPOINT = 769;

const VehiclePopup: Component<VehiclePopupProps> = (props) => {
  const [isMobile, setIsMobile] = createSignal(
    typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT,
  );
  let activePopup: maplibregl.Popup | null = null;
  let popupContainer: HTMLDivElement | null = null;
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

  const vehicle = createMemo<Vehicle | null>(() => {
    const id = selectedVehicle();
    return id ? (transitState.vehicles[id] ?? null) : null;
  });

  const line = createMemo<TransitLine | null>(() => {
    const v = vehicle();
    if (!v) return null;
    return transitState.lines.find((l) => l.id === v.routeId) ?? null;
  });

  function destroyDesktopPopup(): void {
    if (activePopup) {
      activePopup.remove();
      activePopup = null;
    }
    popupContainer = null;
    currentVehicleId = null;
  }

  function handleClose(): void {
    if (selectedVehicle()) setSelectedVehicle(null);
  }

  function toggleFollow(): void {
    const id = vehicle()?.id;
    if (!id) return;
    if (followedVehicle() === id) setFollowedVehicle(null);
    else setFollowedVehicle(id);
  }

  function onResize(): void {
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
  }
  if (typeof window !== "undefined") {
    window.addEventListener("resize", onResize);
  }

  // Desktop popup management
  createEffect(() => {
    if (isMobile()) {
      destroyDesktopPopup();
      currentVehicleId = selectedVehicle();
      return;
    }
    const v = vehicle();
    if (!v) {
      destroyDesktopPopup();
      return;
    }
    if (v.id === currentVehicleId && activePopup) {
      activePopup.setLngLat([v.lon, v.lat]);
      return;
    }

    destroyDesktopPopup();
    currentVehicleId = v.id;
    popupContainer = document.createElement("div");
    popupContainer.className = "vehicle-popup-host";
    const popup = new maplibregl.Popup({
      closeOnClick: false,
      closeButton: false,
      maxWidth: "320px",
      className: "toloseo-popup",
      offset: 14,
    })
      .setLngLat([v.lon, v.lat])
      .setDOMContent(popupContainer)
      .addTo(props.map);
    popup.on("close", handleClose);
    activePopup = popup;
  });

  // Re-center the map on a followed vehicle's position changes.
  createEffect(() => {
    const id = followedVehicle();
    if (!id) return;
    const v = transitState.vehicles[id];
    if (!v) return;
    props.map.easeTo({ center: [v.lon, v.lat], duration: 600 });
  });

  // Keep the desktop popup anchored to the live position.
  createEffect(() => {
    if (isMobile() || !activePopup) return;
    const v = vehicle();
    if (!v) return;
    activePopup.setLngLat([v.lon, v.lat]);
  });

  onCleanup(() => {
    destroyDesktopPopup();
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", onResize);
    }
  });

  const headsign = createMemo(() => {
    const stops = nextStops() ?? [];
    return stops[stops.length - 1]?.stopName ?? line()?.longName ?? "";
  });

  return (
    <>
      <Show when={isMobile()}>
        <BottomSheet
          open={!!vehicle()}
          onClose={handleClose}
          ariaLabel={
            vehicle()
              ? `Bus ${line()?.shortName ?? ""} vers ${headsign()}`
              : "Véhicule"
          }
        >
          <Show when={vehicle()}>
            <Body
              v={vehicle()!}
              line={line()}
              upcoming={nextStops() ?? []}
              loading={nextStops.loading}
              headsign={headsign()}
              followed={followedVehicle() === vehicle()!.id}
              onToggleFollow={toggleFollow}
            />
          </Show>
        </BottomSheet>
      </Show>

      <Show when={!isMobile() && popupContainer && vehicle()}>
        <Portal mount={popupContainer!}>
          <Body
            v={vehicle()!}
            line={line()}
            upcoming={nextStops() ?? []}
            loading={nextStops.loading}
            headsign={headsign()}
            followed={followedVehicle() === vehicle()!.id}
            onToggleFollow={toggleFollow}
            onClose={handleClose}
          />
        </Portal>
      </Show>
    </>
  );
};

interface BodyProps {
  v: Vehicle;
  line: TransitLine | null;
  upcoming: NextStopInfo[];
  loading: boolean;
  headsign: string;
  followed: boolean;
  onToggleFollow: () => void;
  onClose?: () => void;
}

const Body: Component<BodyProps> = (p) => {
  const bg = () => p.line?.color ?? "#e86b5c";
  const fg = () =>
    pickReadableTextColor(bg(), p.line?.textColor ?? null);
  const delta = () => formatDelayDelta(p.v.delay);
  const deltaClass = () =>
    p.v.delay >= 0
      ? "vehicle-popup__delta vehicle-popup__delta--late"
      : "vehicle-popup__delta vehicle-popup__delta--early";
  return (
    <div class="vehicle-popup">
      <div class="vehicle-popup__header">
        <span
          class="vehicle-popup__badge vehicle-popup__badge--xl"
          style={{ background: bg(), color: fg() }}
        >
          {p.line?.shortName ?? "?"}
        </span>
        <div class="vehicle-popup__header-main">
          <span class="vehicle-popup__direction">{p.headsign}</span>
          <Show
            when={delta()}
            fallback={<span class="vehicle-popup__on-time">à l'heure</span>}
          >
            <span class={deltaClass()}>{delta()}</span>
          </Show>
        </div>
        <Show when={p.onClose}>
          <button
            type="button"
            class="vehicle-popup__close"
            onClick={p.onClose}
            aria-label="Fermer"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </Show>
      </div>
      <div class="vehicle-popup__section">
        <h4 class="vehicle-popup__section-title">Prochains arrêts</h4>
        <Show
          when={!p.loading && p.upcoming.length > 0}
          fallback={
            <p class="vehicle-popup__loading">
              {p.loading ? "Chargement…" : "Aucune prédiction disponible"}
            </p>
          }
        >
          <ul class="vehicle-popup__stops">
            <For each={p.upcoming.slice(0, 5)}>
              {(s) => <UpcomingStop s={s} />}
            </For>
          </ul>
        </Show>
      </div>
      <button
        type="button"
        class="vehicle-popup__follow"
        onClick={p.onToggleFollow}
      >
        {p.followed ? "Arrêter le suivi" : "Suivre ce véhicule"}
      </button>
    </div>
  );
};

const UpcomingStop: Component<{ s: NextStopInfo }> = (p) => {
  const arrival = () => p.s.estimatedArrival || p.s.scheduledArrival;
  const countdown = () =>
    arrival() > 0 ? formatCountdown(arrival(), Date.now()) : "—";
  const scheduled = () =>
    p.s.scheduledArrival ? formatTime(p.s.scheduledArrival) : "";
  const delta = () => formatDelayDelta(p.s.delay);
  const deltaClass = () =>
    p.s.delay >= 0
      ? "vehicle-popup__delta vehicle-popup__delta--late"
      : "vehicle-popup__delta vehicle-popup__delta--early";
  return (
    <li class="vehicle-popup__stop">
      <span class="vehicle-popup__stop-name">{p.s.stopName}</span>
      <span class="vehicle-popup__stop-times">
        <span class="vehicle-popup__stop-countdown tabular">{countdown()}</span>
        <Show when={delta()}>
          <span class={deltaClass()}>{delta()}</span>
        </Show>
        <Show when={delta() && scheduled()}>
          <span class="vehicle-popup__stop-scheduled tabular">{scheduled()}</span>
        </Show>
      </span>
    </li>
  );
};

export default VehiclePopup;
