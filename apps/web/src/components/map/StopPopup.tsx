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
import maplibregl from "maplibre-gl";
import { selectedStop, setSelectedStop } from "../../stores/ui";
import { transitState } from "../../stores/transit";
import { getStopDepartures } from "../../services/api";
import { formatTime, formatCountdown, formatDelayDelta } from "../../utils/format";
import { pickReadableTextColor } from "../../utils/contrast";
import BottomSheet from "../ui/BottomSheet";
import type { DepartureInfo } from "@shared/types";

interface StopPopupProps {
  map: maplibregl.Map;
}

const POPUP_REFRESH_MS = 15_000;
const MOBILE_BREAKPOINT = 769;

interface DepartureGroup {
  key: string;
  shortName: string;
  headsign: string;
  color: string;
  textColor: string;
  departures: DepartureInfo[];
}

const StopPopup: Component<StopPopupProps> = (props) => {
  const [refreshTick, setRefreshTick] = createSignal(0);
  const [isMobile, setIsMobile] = createSignal(
    typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT,
  );
  let activePopup: maplibregl.Popup | null = null;
  let popupContainer: HTMLDivElement | null = null;
  let currentStopId: string | null = null;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;

  const [departures] = createResource(
    () => {
      const id = selectedStop();
      return id ? ({ id, tick: refreshTick() } as const) : null;
    },
    async (source): Promise<DepartureInfo[]> => {
      if (!source) return [];
      try {
        return await getStopDepartures(source.id);
      } catch {
        return [];
      }
    },
  );

  function stopRefreshTimer(): void {
    if (refreshTimer !== null) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  function startRefreshTimer(): void {
    stopRefreshTimer();
    refreshTimer = setInterval(() => {
      setRefreshTick((n) => n + 1);
    }, POPUP_REFRESH_MS);
  }

  function handleClose(): void {
    stopRefreshTimer();
    if (selectedStop()) setSelectedStop(null);
  }

  function destroyDesktopPopup(): void {
    if (activePopup) {
      activePopup.off("close", handleClose);
      activePopup.remove();
      activePopup = null;
    }
    popupContainer = null;
    currentStopId = null;
  }

  // Track viewport so the right surface (popup vs sheet) is mounted.
  function onResize(): void {
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
  }
  if (typeof window !== "undefined") {
    window.addEventListener("resize", onResize);
  }

  const stop = createMemo(() => {
    const id = selectedStop();
    return id ? transitState.stops[id] : null;
  });

  const groups = createMemo<DepartureGroup[]>(() => {
    const list = departures() ?? [];
    const map = new Map<string, DepartureGroup>();
    for (const dep of list) {
      const key = `${dep.routeId}|${dep.tripHeadsign}`;
      let group = map.get(key);
      if (!group) {
        const line = transitState.lines.find((l) => l.id === dep.routeId);
        const bg = dep.routeColor || line?.color || "#e86b5c";
        group = {
          key,
          shortName: dep.routeShortName || line?.shortName || "?",
          headsign: dep.tripHeadsign,
          color: bg,
          textColor: pickReadableTextColor(bg, line?.textColor ?? null),
          departures: [],
        };
        map.set(key, group);
      }
      group.departures.push(dep);
    }
    return [...map.values()].sort(
      (a, b) =>
        (a.departures[0]?.estimatedTime ?? 0) -
        (b.departures[0]?.estimatedTime ?? 0),
    );
  });

  // Desktop: render a MapLibre Popup anchored to the stop coordinates.
  // We mount our JSX into a detached container the first time, then reuse
  // it for subsequent stop selections — Solid keeps the children reactive.
  createEffect(() => {
    if (isMobile()) {
      destroyDesktopPopup();
      const id = selectedStop();
      if (id && id !== currentStopId) {
        currentStopId = id;
        startRefreshTimer();
      } else if (!id) {
        stopRefreshTimer();
        currentStopId = null;
      }
      return;
    }

    const id = selectedStop();
    if (!id) {
      destroyDesktopPopup();
      return;
    }
    const s = transitState.stops[id];
    if (!s) return;
    if (id === currentStopId && activePopup) {
      activePopup.setLngLat([s.lon, s.lat]);
      return;
    }

    destroyDesktopPopup();
    currentStopId = id;
    popupContainer = document.createElement("div");
    popupContainer.className = "stop-popup-host";

    const popup = new maplibregl.Popup({
      closeOnClick: false,
      closeButton: false,
      maxWidth: "320px",
      className: "toloseo-popup",
      offset: 12,
    })
      .setLngLat([s.lon, s.lat])
      .setDOMContent(popupContainer)
      .addTo(props.map);
    popup.on("close", handleClose);
    activePopup = popup;
    startRefreshTimer();
  });

  onCleanup(() => {
    destroyDesktopPopup();
    stopRefreshTimer();
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", onResize);
    }
  });

  return (
    <>
      {/* Mobile: bottom sheet */}
      <Show when={isMobile()}>
        <BottomSheet
          open={!!stop()}
          onClose={handleClose}
          ariaLabel={stop()?.name ?? "Arrêt"}
          title={stop()?.name}
        >
          <Body
            loading={departures.loading}
            groups={groups()}
            empty={(departures()?.length ?? 0) === 0}
          />
        </BottomSheet>
      </Show>

      {/* Desktop: portal into the popup container that MapLibre owns */}
      <Show when={!isMobile() && popupContainer && stop()}>
        <DesktopPopup
          container={popupContainer!}
          stopName={stop()!.name}
          loading={departures.loading}
          groups={groups()}
          empty={(departures()?.length ?? 0) === 0}
          onClose={handleClose}
        />
      </Show>
    </>
  );
};

interface BodyProps {
  loading: boolean;
  groups: DepartureGroup[];
  empty: boolean;
}

const Body: Component<BodyProps> = (p) => (
  <Show
    when={!p.loading && !p.empty}
    fallback={
      p.loading ? (
        <p class="stop-popup__loading">Chargement des départs…</p>
      ) : (
        <p class="stop-popup__empty">Aucun départ prévu</p>
      )
    }
  >
    <ul class="stop-popup__groups">
      <For each={p.groups.slice(0, 5)}>{(group) => <Group group={group} />}</For>
    </ul>
  </Show>
);

const Group: Component<{ group: DepartureGroup }> = (p) => {
  const next = () => p.group.departures.slice(0, 3);
  const first = () => next()[0];
  const dotClass = () =>
    first()?.isRealtime
      ? "stop-popup__dot stop-popup__dot--live"
      : "stop-popup__dot stop-popup__dot--theoretical";
  return (
    <li class="stop-popup__group">
      <span
        class="stop-popup__badge"
        style={{
          background: p.group.color,
          color: p.group.textColor,
        }}
      >
        {p.group.shortName}
      </span>
      <div class="stop-popup__group-body">
        <div class="stop-popup__group-top">
          <span class="stop-popup__direction">{p.group.headsign}</span>
          <span
            class={dotClass()}
            title={first()?.isRealtime ? "Temps réel" : "Horaire théorique"}
            aria-hidden="true"
          />
        </div>
        <div class="stop-popup__group-times">
          <For each={next()}>
            {(dep, i) => (
              <>
                <Show when={i() > 0}>
                  <span class="stop-popup__sep" aria-hidden="true">·</span>
                </Show>
                <Countdown dep={dep} showDelta={i() === 0} />
              </>
            )}
          </For>
        </div>
      </div>
    </li>
  );
};

const Countdown: Component<{ dep: DepartureInfo; showDelta: boolean }> = (p) => {
  const delta = () => formatDelayDelta(p.dep.delay);
  const deltaClass = () =>
    p.dep.delay > 0
      ? "stop-popup__delta stop-popup__delta--late"
      : "stop-popup__delta stop-popup__delta--early";
  return (
    <span class="stop-popup__time-block">
      <span class="stop-popup__countdown tabular">
        {formatCountdown(p.dep.estimatedTime, Date.now())}
      </span>
      <Show when={p.showDelta && delta()}>
        <span class={deltaClass()}>{delta()}</span>
      </Show>
      <Show when={p.showDelta}>
        <span class="stop-popup__scheduled tabular">
          {formatTime(p.dep.scheduledTime)}
        </span>
      </Show>
    </span>
  );
};

interface DesktopPopupProps extends BodyProps {
  container: HTMLElement;
  stopName: string;
  onClose: () => void;
}

import { Portal } from "solid-js/web";

const DesktopPopup: Component<DesktopPopupProps> = (p) => (
  <Portal mount={p.container}>
    <div class="stop-popup">
      <div class="stop-popup__header">
        <h3 class="stop-popup__title">{p.stopName}</h3>
        <button
          type="button"
          class="stop-popup__close"
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
      </div>
      <Body loading={p.loading} groups={p.groups} empty={p.empty} />
    </div>
  </Portal>
);

export default StopPopup;
