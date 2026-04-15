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
const [selectedLine, setSelectedLine] = createSignal<string | null>(null);
const [selectedStop, setSelectedStop] = createSignal<string | null>(null);
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

createEffect(() => {
  document.documentElement.setAttribute("data-theme", theme());
});

export {
  theme,
  setTheme,
  toggleTheme,
  selectedLine,
  setSelectedLine,
  selectedStop,
  setSelectedStop,
  sidebarOpen,
  setSidebarOpen,
  toggleSidebar,
  currentView,
  setCurrentView,
};
