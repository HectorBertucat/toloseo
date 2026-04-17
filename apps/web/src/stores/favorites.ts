import { createSignal } from "solid-js";

type FavoriteLine = {
  kind: "line";
  lineId: string;
  addedAt: number;
  lastUsedAt: number;
};
type FavoriteStop = {
  kind: "stop";
  stopId: string;
  nickname?: string;
  addedAt: number;
  lastUsedAt: number;
};
type Favorite = FavoriteLine | FavoriteStop;

interface FavoritesStore {
  version: 1;
  items: Favorite[];
}

const STORAGE_KEY = "toloseo:favorites:v1";
const EMPTY: FavoritesStore = { version: 1, items: [] };

function load(): FavoritesStore {
  if (typeof localStorage === "undefined") return EMPTY;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as FavoritesStore;
    if (parsed.version !== 1 || !Array.isArray(parsed.items)) return EMPTY;
    return parsed;
  } catch {
    return EMPTY;
  }
}

function persist(store: FavoritesStore): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* quota exceeded — silently drop */
  }
}

const [favorites, setFavorites] = createSignal<FavoritesStore>(load());

function favoriteLines(): string[] {
  return favorites()
    .items.filter((i): i is FavoriteLine => i.kind === "line")
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    .map((i) => i.lineId);
}

function favoriteStops(): FavoriteStop[] {
  return favorites()
    .items.filter((i): i is FavoriteStop => i.kind === "stop")
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

function isFavoriteLine(lineId: string): boolean {
  return favorites().items.some(
    (i) => i.kind === "line" && i.lineId === lineId,
  );
}

function isFavoriteStop(stopId: string): boolean {
  return favorites().items.some(
    (i) => i.kind === "stop" && i.stopId === stopId,
  );
}

function toggleFavoriteLine(lineId: string): void {
  const now = Date.now();
  const store = favorites();
  const existing = store.items.find(
    (i) => i.kind === "line" && i.lineId === lineId,
  );
  const next: FavoritesStore = existing
    ? {
        ...store,
        items: store.items.filter(
          (i) => !(i.kind === "line" && i.lineId === lineId),
        ),
      }
    : {
        ...store,
        items: [
          ...store.items,
          { kind: "line", lineId, addedAt: now, lastUsedAt: now },
        ],
      };
  setFavorites(next);
  persist(next);
}

function toggleFavoriteStop(stopId: string, nickname?: string): void {
  const now = Date.now();
  const store = favorites();
  const existing = store.items.find(
    (i) => i.kind === "stop" && i.stopId === stopId,
  );
  const next: FavoritesStore = existing
    ? {
        ...store,
        items: store.items.filter(
          (i) => !(i.kind === "stop" && i.stopId === stopId),
        ),
      }
    : {
        ...store,
        items: [
          ...store.items,
          {
            kind: "stop",
            stopId,
            nickname,
            addedAt: now,
            lastUsedAt: now,
          },
        ],
      };
  setFavorites(next);
  persist(next);
}

function touchFavoriteLine(lineId: string): void {
  const store = favorites();
  const item = store.items.find(
    (i) => i.kind === "line" && i.lineId === lineId,
  );
  if (!item) return;
  const next: FavoritesStore = {
    ...store,
    items: store.items.map((i) =>
      i === item ? { ...i, lastUsedAt: Date.now() } : i,
    ),
  };
  setFavorites(next);
  persist(next);
}

function importFromQuery(): number {
  if (typeof window === "undefined") return 0;
  const params = new URLSearchParams(window.location.search);
  const favParam = params.get("fav");
  if (!favParam) return 0;
  const ids = favParam.split(",").map((s) => s.trim()).filter(Boolean);
  let added = 0;
  for (const raw of ids) {
    if (raw.startsWith("stop:")) {
      const stopId = raw.slice(5);
      if (stopId && !isFavoriteStop(stopId)) {
        toggleFavoriteStop(stopId);
        added += 1;
      }
    } else if (!isFavoriteLine(raw)) {
      toggleFavoriteLine(raw);
      added += 1;
    }
  }
  // Clean the URL so refreshes don't re-import.
  params.delete("fav");
  const q = params.toString();
  const url = `${window.location.pathname}${q ? `?${q}` : ""}${window.location.hash}`;
  window.history.replaceState(null, "", url);
  return added;
}

function buildShareLink(): string {
  if (typeof window === "undefined") return "";
  const lines = favoriteLines();
  const stops = favoriteStops().map((s) => `stop:${s.stopId}`);
  const fav = [...lines, ...stops].join(",");
  if (!fav) return window.location.origin;
  const url = new URL(window.location.origin);
  url.searchParams.set("fav", fav);
  return url.toString();
}

export {
  favorites,
  favoriteLines,
  favoriteStops,
  isFavoriteLine,
  isFavoriteStop,
  toggleFavoriteLine,
  toggleFavoriteStop,
  touchFavoriteLine,
  importFromQuery,
  buildShareLink,
};
export type { Favorite, FavoriteLine, FavoriteStop };
