import { type Component, For, Show, createMemo, onMount } from "solid-js";
import { A } from "@solidjs/router";
import { transitState, setLines } from "../../stores/transit";
import { getLines } from "../../services/api";
import {
  favoriteLines,
  favoriteStops,
  toggleFavoriteLine,
  toggleFavoriteStop,
  buildShareLink,
} from "../../stores/favorites";
import { setSelectedLine } from "../../stores/ui";
import ModeIcon from "../ui/ModeIcon";
import StarButton from "../ui/StarButton";
import "../../styles/components/favorites-view.css";

const FavoritesView: Component = () => {
  onMount(async () => {
    if (transitState.lines.length === 0) {
      try {
        const lines = await getLines();
        setLines(lines);
      } catch {
        /* ignore */
      }
    }
  });

  const lineEntries = createMemo(() =>
    favoriteLines()
      .map((id) => transitState.lines.find((l) => l.id === id))
      .filter((l): l is NonNullable<typeof l> => !!l),
  );

  async function share(): Promise<void> {
    const url = buildShareLink();
    try {
      if (navigator.share) {
        await navigator.share({ url, title: "Mes favoris Toloseo" });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        alert("Lien copie dans le presse-papier");
      }
    } catch {
      /* user cancelled */
    }
  }

  return (
    <div class="favorites-view">
      <header class="favorites-view__header">
        <h1 class="favorites-view__title">Favoris</h1>
        <Show when={lineEntries().length > 0 || favoriteStops().length > 0}>
          <button
            type="button"
            class="favorites-view__share"
            onClick={share}
            aria-label="Partager mes favoris"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
              <path d="M16 6l-4-4-4 4" />
              <path d="M12 2v13" />
            </svg>
            Partager
          </button>
        </Show>
      </header>

      <Show
        when={lineEntries().length > 0 || favoriteStops().length > 0}
        fallback={<EmptyState />}
      >
        <Show when={lineEntries().length > 0}>
          <section class="favorites-view__section">
            <h2 class="favorites-view__section-title">Lignes</h2>
            <ul class="favorites-view__list">
              <For each={lineEntries()}>
                {(line) => (
                  <li class="favorites-view__item">
                    <A
                      href="/"
                      class="favorites-view__link"
                      onClick={() => setSelectedLine(line.id)}
                    >
                      <span class="favorites-view__mode">
                        <ModeIcon mode={line.mode} />
                      </span>
                      <span
                        class="favorites-view__badge"
                        style={{
                          "background-color": line.color,
                          color: line.textColor,
                        }}
                      >
                        {line.shortName}
                      </span>
                      <span class="favorites-view__name truncate">
                        {line.longName}
                      </span>
                    </A>
                    <StarButton
                      filled
                      label={`Retirer ${line.shortName} des favoris`}
                      onToggle={() => toggleFavoriteLine(line.id)}
                    />
                  </li>
                )}
              </For>
            </ul>
          </section>
        </Show>

        <Show when={favoriteStops().length > 0}>
          <section class="favorites-view__section">
            <h2 class="favorites-view__section-title">Arrets</h2>
            <ul class="favorites-view__list">
              <For each={favoriteStops()}>
                {(stop) => (
                  <li class="favorites-view__item">
                    <A
                      href={`/board/${encodeURIComponent(stop.stopId)}`}
                      class="favorites-view__link"
                    >
                      <span class="favorites-view__name truncate">
                        {stop.nickname ?? stop.stopId}
                      </span>
                    </A>
                    <StarButton
                      filled
                      label="Retirer cet arret des favoris"
                      onToggle={() => toggleFavoriteStop(stop.stopId)}
                    />
                  </li>
                )}
              </For>
            </ul>
          </section>
        </Show>
      </Show>
    </div>
  );
};

const EmptyState: Component = () => (
  <div class="favorites-view__empty">
    <div class="favorites-view__empty-glyph" aria-hidden="true">
      <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 17.3 5.6 21l1.7-7.3L2 8.8l7.4-.6L12 1.5l2.6 6.7 7.4.6-5.3 4.9L18.4 21Z" />
      </svg>
    </div>
    <h2 class="favorites-view__empty-title">Pas encore de favoris</h2>
    <p class="favorites-view__empty-text">
      Ajoutez vos lignes preferees depuis la carte en appuyant sur l&apos;etoile.
    </p>
    <A href="/" class="favorites-view__empty-cta">
      Explorer la carte
    </A>
  </div>
);

export default FavoritesView;
