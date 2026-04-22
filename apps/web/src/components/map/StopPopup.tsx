import {
  type Component,
  createEffect,
  createResource,
  onCleanup,
  untrack,
} from "solid-js";
import maplibregl from "maplibre-gl";
import { selectedStop, setSelectedStop } from "../../stores/ui";
import { transitState } from "../../stores/transit";
import { getStopDepartures } from "../../services/api";
import { formatTime, formatCountdown, formatDelayDelta } from "../../utils/format";
import { pickReadableTextColor } from "../../utils/contrast";
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
    deps: DepartureInfo[],
    loading: boolean,
  ): string {
    let html = `<div class="stop-popup">`;
    html += `<div class="stop-popup__header"><h3 class="stop-popup__title">${escapeHtml(stopName)}</h3></div>`;

    if (loading) {
      html += `<p class="stop-popup__loading">Chargement des departs…</p>`;
    } else if (deps.length === 0) {
      html += `<p class="stop-popup__empty">Aucun depart prevu</p>`;
    } else {
      html += renderGroupedDepartures(deps);
    }

    html += `</div>`;
    return html;
  }

  function renderGroupedDepartures(deps: DepartureInfo[]): string {
    const groups = groupByLineDirection(deps);
    let html = `<ul class="stop-popup__groups">`;
    for (const group of groups.slice(0, 5)) {
      const nextDeps = group.departures.slice(0, 3);
      const first = nextDeps[0];
      if (!first) continue;

      const delta = formatDelayDelta(first.delay);
      const dotClass = first.isRealtime
        ? "stop-popup__dot stop-popup__dot--live"
        : "stop-popup__dot stop-popup__dot--theoretical";

      html += `<li class="stop-popup__group">`;
      html += `<span class="stop-popup__badge" style="background:${escapeHtml(group.color)};color:${escapeHtml(group.textColor)}">${escapeHtml(group.shortName)}</span>`;
      html += `<div class="stop-popup__group-body">`;
      html += `<div class="stop-popup__group-top">`;
      html += `<span class="stop-popup__direction">${escapeHtml(group.headsign)}</span>`;
      html += `<span class="${dotClass}" title="${first.isRealtime ? "Temps reel" : "Horaire theorique"}"></span>`;
      html += `</div>`;
      html += `<div class="stop-popup__group-times">`;
      html += nextDeps
        .map((dep, i) => renderCountdown(dep, i === 0 ? delta : null))
        .join(`<span class="stop-popup__sep" aria-hidden="true">·</span>`);
      html += `</div>`;
      html += `</div>`;
      html += `</li>`;
    }
    html += `</ul>`;
    return html;
  }

  function renderCountdown(dep: DepartureInfo, delta: string | null): string {
    const countdown = formatCountdown(dep.estimatedTime, Date.now());
    const scheduled = formatTime(dep.scheduledTime);
    const showScheduled = delta !== null;
    const deltaClass =
      dep.delay > 0
        ? "stop-popup__delta stop-popup__delta--late"
        : "stop-popup__delta stop-popup__delta--early";

    let html = `<span class="stop-popup__time-block">`;
    html += `<span class="stop-popup__countdown">${escapeHtml(countdown)}</span>`;
    if (delta) {
      html += `<span class="${deltaClass}">${escapeHtml(delta)}</span>`;
    }
    if (showScheduled) {
      html += `<span class="stop-popup__scheduled">${escapeHtml(scheduled)}</span>`;
    }
    html += `</span>`;
    return html;
  }

  interface DepartureGroup {
    shortName: string;
    headsign: string;
    color: string;
    textColor: string;
    departures: DepartureInfo[];
  }

  function groupByLineDirection(deps: DepartureInfo[]): DepartureGroup[] {
    const map = new Map<string, DepartureGroup>();
    for (const dep of deps) {
      const key = `${dep.routeId}|${dep.tripHeadsign}`;
      let group = map.get(key);
      if (!group) {
        const line = transitState.lines.find((l) => l.id === dep.routeId);
        const bg = dep.routeColor || line?.color || "#e86b5c";
        group = {
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
    // Sort groups by their earliest departure
    return [...map.values()].sort(
      (a, b) =>
        (a.departures[0]?.estimatedTime ?? 0) -
        (b.departures[0]?.estimatedTime ?? 0),
    );
  }

  function closePopup(): void {
    if (activePopup) {
      activePopup.off("close", handlePopupClose);
      activePopup.remove();
      activePopup = null;
    }
    currentStopId = null;
  }

  function handlePopupClose(): void {
    activePopup = null;
    const previousId = currentStopId;
    currentStopId = null;
    if (selectedStop() === previousId) {
      setSelectedStop(null);
    }
  }

  // Effect 1: create / destroy popup ONLY when the selected stop changes.
  // Reads of departures() are wrapped in untrack() so this effect doesn't
  // re-run when the departures resource updates.
  createEffect(() => {
    const stopId = selectedStop();

    if (stopId === currentStopId) return;

    if (!stopId) {
      closePopup();
      return;
    }

    const stop = transitState.stops[stopId];
    if (!stop) return;

    closePopup();
    currentStopId = stopId;

    const initialHtml = untrack(() =>
      buildPopupHTML(stop.name, departures() ?? [], departures.loading),
    );

    const popup = new maplibregl.Popup({
      closeOnClick: false,
      closeButton: true,
      maxWidth: "320px",
      className: "toloseo-popup",
      offset: 12,
    })
      .setLngLat([stop.lon, stop.lat])
      .setHTML(initialHtml)
      .addTo(props.map);

    popup.on("close", handlePopupClose);

    activePopup = popup;
  });

  // Effect 2: update popup HTML when departures change (without recreating).
  createEffect(() => {
    const deps = departures();
    const loading = departures.loading;
    const popup = activePopup;
    const stopId = currentStopId;
    if (!popup || !stopId) return;
    const stop = transitState.stops[stopId];
    if (!stop) return;
    popup.setHTML(buildPopupHTML(stop.name, deps ?? [], loading));
  });

  onCleanup(() => closePopup());

  return null;
};

const HTML_ESCAPE_RE = /[&<>"']/g;
const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(text: string): string {
  return text.replace(HTML_ESCAPE_RE, (c) => HTML_ESCAPE_MAP[c] ?? c);
}

export default StopPopup;
