import { createSignal, createEffect } from "solid-js";

type Theme = "dark" | "light";
type CurrentView = "map" | "board" | "analytics";

function loadTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const stored = localStorage.getItem("toloseo-theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

const [theme, setThemeSignal] = createSignal<Theme>(loadTheme());
// Deprecated: single selection. Kept for backward compat with LineLayer.
// Prefer selectedLineIds for multi-select.
const [selectedLine, setSelectedLineSignal] = createSignal<string | null>(null);
const [selectedLineIds, setSelectedLineIdsSignal] = createSignal<string[]>([]);
const [selectedStop, setSelectedStop] = createSignal<string | null>(null);
const [selectedVehicle, setSelectedVehicle] = createSignal<string | null>(null);
const [followedVehicle, setFollowedVehicle] = createSignal<string | null>(null);
const [sidebarOpen, setSidebarOpen] = createSignal(true);
const [currentView, setCurrentView] = createSignal<CurrentView>("map");

function setTheme(next: Theme): void {
  setThemeSignal(next);
  localStorage.setItem("toloseo-theme", next);
  document.documentElement.setAttribute("data-theme", next);
}

function toggleTheme(): void {
  setTheme(theme() === "dark" ? "light" : "dark");
}

function toggleSidebar(): void {
  setSidebarOpen((prev) => !prev);
}

function toggleLineSelection(lineId: string): void {
  const current = selectedLineIds();
  if (current.includes(lineId)) {
    setSelectedLineIdsSignal(current.filter((id) => id !== lineId));
  } else {
    setSelectedLineIdsSignal([...current, lineId]);
  }
  // Keep legacy single-line signal in sync with the most recently added selection
  const next = selectedLineIds();
  setSelectedLineSignal(next.length > 0 ? next[next.length - 1]! : null);
}

function setSelectedLine(lineId: string | null): void {
  setSelectedLineSignal(lineId);
  setSelectedLineIdsSignal(lineId ? [lineId] : []);
}

function isLineSelected(lineId: string): boolean {
  return selectedLineIds().includes(lineId);
}

createEffect(() => {
  document.documentElement.setAttribute("data-theme", theme());
});

export {
  theme,
  setTheme,
  toggleTheme,
  selectedLine,
  setSelectedLine,
  selectedLineIds,
  toggleLineSelection,
  isLineSelected,
  selectedStop,
  setSelectedStop,
  selectedVehicle,
  setSelectedVehicle,
  followedVehicle,
  setFollowedVehicle,
  sidebarOpen,
  setSidebarOpen,
  toggleSidebar,
  currentView,
  setCurrentView,
};
