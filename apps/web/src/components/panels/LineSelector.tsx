import {
  type Component,
  For,
  Show,
  createSignal,
  createMemo,
  createEffect,
  onMount,
} from "solid-js";
import { transitState } from "../../stores/transit";
import {
  isLineSelected,
  toggleLineSelection,
  sidebarOpen,
  toggleSidebar,
} from "../../stores/ui";
import { getLines } from "../../services/api";
import { setLines } from "../../stores/transit";
import { formatDelay } from "../../utils/format";
import ModeIcon from "../ui/ModeIcon";
import TrendBadge from "../analytics/TrendBadge";
import "../../styles/components/line-selector.css";
import type { TransitLine, TransitMode } from "@shared/types";

type BottomSheetState = "peek" | "full";

const MODE_ORDER: TransitMode[] = ["metro", "tram", "cable", "bus"];

const MODE_LABELS: Record<TransitMode, string> = {
  metro: "Metro",
  tram: "Tramway",
  cable: "Teleocab",
  bus: "Bus",
};

const LineSelector: Component = () => {
  const [search, setSearch] = createSignal("");
  const [sheetState, setSheetState] = createSignal<BottomSheetState>("peek");
  const [isMobile, setIsMobile] = createSignal(false);

  onMount(async () => {
    checkMobile();
    window.addEventListener("resize", checkMobile);

    try {
      const lines = await getLines();
      setLines(lines);
      // Default: preselect metro A and B on first visit
      const hasVisited = localStorage.getItem("toloseo-visited");
      if (!hasVisited) {
        const metros = lines.filter((l) => l.mode === "metro");
        for (const line of metros) {
          toggleLineSelection(line.id);
        }
        localStorage.setItem("toloseo-visited", "1");
      }
    } catch (err) {
      console.error("Failed to load lines:", err);
    }
  });

  function checkMobile(): void {
    setIsMobile(window.innerWidth < 768);
  }

  const filteredLines = createMemo(() => {
    const term = search().toLowerCase();
    return transitState.lines.filter(
      (line) =>
        line.shortName.toLowerCase().includes(term) ||
        line.longName.toLowerCase().includes(term),
    );
  });

  const groupedLines = createMemo(() => {
    const groups = new Map<TransitMode, TransitLine[]>();
    for (const mode of MODE_ORDER) {
      const lines = filteredLines().filter((l) => l.mode === mode);
      if (lines.length > 0) {
        groups.set(mode, lines);
      }
    }
    return groups;
  });

  function handleLineClick(lineId: string): void {
    toggleLineSelection(lineId);
  }

  function handleSheetToggle(): void {
    setSheetState((prev) => (prev === "peek" ? "full" : "peek"));
  }

  return (
    <Show when={isMobile()} fallback={<DesktopSidebar />}>
      <div
        class="line-selector line-selector--mobile"
        data-state={sheetState()}
      >
        <button class="line-selector__handle" onClick={handleSheetToggle}>
          <span class="line-selector__handle-bar" />
        </button>
        <SelectorContent />
      </div>
    </Show>
  );

  function DesktopSidebar(): ReturnType<Component> {
    return (
      <div
        class="line-selector line-selector--desktop"
        classList={{ "line-selector--collapsed": !sidebarOpen() }}
      >
        <div class="line-selector__header">
          <h2 class="line-selector__title">Lignes</h2>
          <button
            class="line-selector__toggle"
            onClick={toggleSidebar}
            aria-label={sidebarOpen() ? "Replier" : "Deplier"}
          >
            {sidebarOpen() ? "\u2039" : "\u203A"}
          </button>
        </div>
        <Show when={sidebarOpen()}>
          <SelectorContent />
        </Show>
      </div>
    );
  }

  function SelectorContent(): ReturnType<Component> {
    return (
      <div class="line-selector__content">
        <div class="line-selector__search">
          <input
            type="text"
            placeholder="Rechercher une ligne..."
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
            class="line-selector__input"
          />
        </div>
        <div class="line-selector__groups">
          <For each={[...groupedLines().entries()]}>
            {([mode, lines]) => (
              <div class="line-selector__group">
                <div class="line-selector__group-header">
                  <ModeIcon mode={mode} />
                  <span>{MODE_LABELS[mode]}</span>
                </div>
                <div class="line-selector__list">
                  <For each={lines}>
                    {(line) => (
                      <button
                        class="line-selector__item"
                        classList={{
                          "line-selector__item--active": isLineSelected(line.id),
                        }}
                        onClick={() => handleLineClick(line.id)}
                      >
                        <span
                          class="line-selector__badge"
                          style={{
                            "background-color": line.color,
                            color: line.textColor,
                          }}
                        >
                          {line.shortName}
                        </span>
                        <span class="line-selector__name truncate">
                          {line.longName}
                        </span>
                        <span class="line-selector__meta">
                          <span class="line-selector__count">
                            {line.vehicleCount}
                          </span>
                          <span class="line-selector__delay">
                            {formatDelay(line.avgDelay)}
                          </span>
                        </span>
                      </button>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
    );
  }
};

export default LineSelector;
