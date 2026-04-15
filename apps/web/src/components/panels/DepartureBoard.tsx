import {
  type Component,
  For,
  Show,
  createResource,
  createMemo,
  onCleanup,
} from "solid-js";
import { useParams } from "@solidjs/router";
import { getStopDepartures } from "../../services/api";
import { formatTime, formatDelay } from "../../utils/format";
import Skeleton from "../ui/Skeleton";
import "../../styles/components/departure-board.css";
import type { DepartureInfo } from "@shared/types";

const REFRESH_INTERVAL_MS = 15_000;

const DepartureBoard: Component = () => {
  const params = useParams<{ stopId?: string }>();

  const [departures, { refetch }] = createResource(
    () => params.stopId,
    async (stopId) => {
      if (!stopId) return [];
      return getStopDepartures(stopId);
    },
  );

  const interval = setInterval(() => {
    if (params.stopId) refetch();
  }, REFRESH_INTERVAL_MS);

  onCleanup(() => clearInterval(interval));

  const groupedDepartures = createMemo(() => {
    const deps = departures();
    if (!deps) return new Map<string, DepartureInfo[]>();

    const groups = new Map<string, DepartureInfo[]>();
    for (const dep of deps) {
      const key = `${dep.routeShortName} - ${dep.tripHeadsign}`;
      const group = groups.get(key);
      if (group) {
        group.push(dep);
      } else {
        groups.set(key, [dep]);
      }
    }
    return groups;
  });

  return (
    <div class="departure-board">
      <div class="departure-board__header">
        <h1 class="departure-board__title">Departs en temps reel</h1>
        <Show when={params.stopId}>
          <p class="departure-board__stop-id">Arret: {params.stopId}</p>
        </Show>
      </div>

      <Show when={!params.stopId}>
        <div class="departure-board__empty">
          <p>Selectionnez un arret pour voir les departs</p>
        </div>
      </Show>

      <Show when={departures.loading}>
        <div class="departure-board__loading">
          <Skeleton width="100%" height="48px" />
          <Skeleton width="100%" height="48px" />
          <Skeleton width="100%" height="48px" />
        </div>
      </Show>

      <Show when={!departures.loading && params.stopId}>
        <div class="departure-board__groups">
          <For each={[...groupedDepartures().entries()]}>
            {([groupKey, deps]) => (
              <div class="departure-board__group">
                <div class="departure-board__group-header">
                  <span
                    class="departure-board__line-badge"
                    style={{
                      "background-color": deps[0]?.routeColor ?? "#666",
                    }}
                  >
                    {deps[0]?.routeShortName ?? "?"}
                  </span>
                  <span class="departure-board__direction">
                    {deps[0]?.tripHeadsign ?? ""}
                  </span>
                </div>
                <div class="departure-board__times">
                  <For each={deps.slice(0, 4)}>
                    {(dep) => (
                      <div class="departure-board__time-row">
                        <span class="departure-board__estimated">
                          {formatTime(dep.estimatedTime)}
                        </span>
                        <Show when={dep.delay !== 0}>
                          <span
                            class="departure-board__delay"
                            classList={{
                              "departure-board__delay--late": dep.delay > 0,
                              "departure-board__delay--early": dep.delay < 0,
                            }}
                          >
                            {formatDelay(dep.delay)}
                          </span>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

export default DepartureBoard;
