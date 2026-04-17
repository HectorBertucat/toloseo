import {
  type Component,
  For,
  Show,
  createSignal,
  createMemo,
  onMount,
} from "solid-js";
import { transitState } from "../../stores/transit";
import {
  isLineSelected,
  toggleLineSelection,
  sidebarOpen,
  toggleSidebar,
  sheetState,
  setSheetState,
  type SheetState,
} from "../../stores/ui";
import { getLines, prefetchLineShape } from "../../services/api";
import { setLines } from "../../stores/transit";
import { formatDelay } from "../../utils/format";
import ModeIcon from "../ui/ModeIcon";
import StarButton from "../ui/StarButton";
import TrendBadge from "../analytics/TrendBadge";
import {
  isFavoriteLine,
  toggleFavoriteLine,
  touchFavoriteLine,
  favoriteLines,
} from "../../stores/favorites";
import "../../styles/components/line-selector.css";
import type { TransitLine, TransitMode } from "@shared/types";

const SHEET_CYCLE: SheetState[] = ["peek", "mid", "full"];

const MODE_ORDER: TransitMode[] = ["metro", "tram", "cable", "bus"];

const MODE_LABELS: Record<TransitMode, string> = {
  metro: "Metro",
  tram: "Tramway",
  cable: "Teleocab",
  bus: "Bus",
};

const LineSelector: Component = () => {
  const [search, setSearch] = createSignal("");
  const [isMobile, setIsMobile] = createSignal(false);

  onMount(async () => {
    checkMobile();
    window.addEventListener("resize", checkMobile);

    try {
      const lines = await getLines();
      setLines(lines);
      // Default: preselect the tram T1 (most active line with live data)
      // Metro A/B are not in the GTFS-RT feed per Tisseo docs
      const hasVisited = localStorage.getItem("toloseo-visited");
      if (!hasVisited) {
        const tram = lines.find((l) => l.mode === "tram" && l.shortName === "T1");
        if (tram) toggleLineSelection(tram.id);
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

  const favLines = createMemo(() =>
    favoriteLines()
      .map((id) => transitState.lines.find((l) => l.id === id))
      .filter((l): l is TransitLine => !!l),
  );

  function LineRow(rowProps: { line: TransitLine }): ReturnType<Component> {
    const line = rowProps.line;
    return (
      <div
        class="line-selector__row"
        classList={{
          "line-selector__row--active": isLineSelected(line.id),
        }}
      >
        <button
          type="button"
          class="line-selector__item"
          classList={{
            "line-selector__item--active": isLineSelected(line.id),
          }}
          onClick={() => handleLineClick(line.id)}
          onPointerEnter={() => prefetchLineShape(line.id)}
          onTouchStart={() => prefetchLineShape(line.id)}
          aria-pressed={isLineSelected(line.id)}
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
          <span class="line-selector__name truncate">{line.longName}</span>
          <span class="line-selector__meta">
            <span class="line-selector__count">{line.vehicleCount}</span>
            <span class="line-selector__delay">
              {formatDelay(line.avgDelay)}
            </span>
          </span>
        </button>
        <StarButton
          filled={isFavoriteLine(line.id)}
          label={
            isFavoriteLine(line.id)
              ? `Retirer ${line.shortName} des favoris`
              : `Ajouter ${line.shortName} aux favoris`
          }
          onToggle={() => toggleFavoriteLine(line.id)}
        />
      </div>
    );
  }

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
    if (isFavoriteLine(lineId)) touchFavoriteLine(lineId);
  }

  function handleSheetToggle(): void {
    const idx = SHEET_CYCLE.indexOf(sheetState());
    const nextState = SHEET_CYCLE[(idx + 1) % SHEET_CYCLE.length] ?? "peek";
    setSheetState(nextState);
  }

  function handleHandleDragStart(ev: PointerEvent): void {
    const target = ev.currentTarget as HTMLElement;
    target.setPointerCapture(ev.pointerId);
    const startY = ev.clientY;
    const startState = sheetState();

    const onMove = (e: PointerEvent): void => {
      const dy = e.clientY - startY;
      // Negative dy = drag up, positive = drag down.
      if (Math.abs(dy) < 24) return;
      const idx = SHEET_CYCLE.indexOf(startState);
      const next = dy < 0 ? Math.min(idx + 1, SHEET_CYCLE.length - 1) : Math.max(idx - 1, 0);
      const nextState = SHEET_CYCLE[next];
      if (nextState && nextState !== sheetState()) setSheetState(nextState);
    };
    const onUp = (): void => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  }

  return (
    <Show when={isMobile()} fallback={<DesktopSidebar />}>
      <div
        class="line-selector line-selector--mobile"
        data-state={sheetState()}
      >
        <button
          class="line-selector__handle"
          onClick={handleSheetToggle}
          onPointerDown={handleHandleDragStart}
          aria-label="Deployer le panneau des lignes"
          role="slider"
          aria-valuemin="0"
          aria-valuemax="2"
          aria-valuenow={SHEET_CYCLE.indexOf(sheetState())}
          aria-valuetext={sheetState()}
        >
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
          <Show when={favLines().length > 0 && search() === ""}>
            <div class="line-selector__group">
              <div class="line-selector__group-header">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 17.3 5.6 21l1.7-7.3L2 8.8l7.4-.6L12 1.5l2.6 6.7 7.4.6-5.3 4.9L18.4 21Z" /></svg>
                <span>Favoris</span>
              </div>
              <div class="line-selector__list">
                <For each={favLines()}>
                  {(line) => <LineRow line={line} />}
                </For>
              </div>
            </div>
          </Show>
          <For each={[...groupedLines().entries()]}>
            {([mode, lines]) => (
              <div class="line-selector__group">
                <div class="line-selector__group-header">
                  <ModeIcon mode={mode} />
                  <span>{MODE_LABELS[mode]}</span>
                </div>
                <div class="line-selector__list">
                  <For each={lines}>
                    {(line) => <LineRow line={line} />}
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
