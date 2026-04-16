import { type Component, onMount, Show, For, createMemo } from "solid-js";
import { A } from "@solidjs/router";
import {
  analyticsState,
  setLoading,
  setError,
  setSummary,
  setDelayByHour,
  setReliability,
  setTrends,
} from "../../stores/analytics";
import {
  getAnalyticsSummary,
  getDelayByHour,
  getReliability,
  getTrends,
  getLines,
} from "../../services/api";
import { transitState, setLines } from "../../stores/transit";
import DelayChart from "./DelayChart";
import Skeleton from "../ui/Skeleton";
import "../../styles/components/analytics.css";

function formatNetworkDelay(seconds: number): string {
  if (seconds === 0) return "à l'heure";
  const abs = Math.abs(seconds);
  const sign = seconds > 0 ? "+" : "−";
  if (abs < 60) return `${sign}${abs}s`;
  const minutes = Math.round(abs / 60);
  return `${sign}${minutes} min`;
}

const AnalyticsView: Component = () => {
  onMount(async () => {
    setLoading(true);
    setError(null);
    try {
      if (transitState.lines.length === 0) {
        const lines = await getLines();
        setLines(lines);
      }
      const [summary, delays, reliability, trends] = await Promise.all([
        getAnalyticsSummary(),
        getDelayByHour(),
        getReliability(),
        getTrends(),
      ]);
      setSummary(summary);
      setDelayByHour(delays);
      setReliability(reliability);
      setTrends(trends);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  });

  const reliabilityWithNames = createMemo(() => {
    return analyticsState.reliability.map((score) => {
      const line = transitState.lines.find((l) => l.id === score.routeId);
      return { ...score, line };
    });
  });

  const bestLines = createMemo(() =>
    [...reliabilityWithNames()].sort((a, b) => b.onTimePercent - a.onTimePercent).slice(0, 5),
  );

  const worstLines = createMemo(() =>
    [...reliabilityWithNames()].sort((a, b) => a.onTimePercent - b.onTimePercent).slice(0, 5),
  );

  return (
    <div class="analytics-view">
      <header class="analytics-view__header">
        <A href="/" class="analytics-view__back">&larr; Retour a la carte</A>
        <h1>Analytique du reseau</h1>
        <p class="analytics-view__subtitle">
          Données temps-réel uniquement (bus + tram). Collecte chaque minute. Les véhicules sans signal live et les valeurs &gt; 30 min sont exclus. Rétention 1 an.
        </p>
      </header>

      <Show when={analyticsState.error}>
        <div class="analytics-view__error">
          <p>Erreur: {analyticsState.error}</p>
        </div>
      </Show>

      <Show when={analyticsState.loading}>
        <div class="analytics-view__loading">
          <Skeleton width="100%" height="200px" />
          <Skeleton width="100%" height="300px" />
        </div>
      </Show>

      <Show when={!analyticsState.loading && !analyticsState.error}>
        <div class="analytics-view__grid">
          <Show when={analyticsState.summary}>
            <section class="analytics-view__summary">
              <div class="analytics-view__stat">
                <span class="analytics-view__stat-value">
                  {analyticsState.summary!.activeVehicles}
                </span>
                <span class="analytics-view__stat-label">
                  Vehicules actifs maintenant
                </span>
              </div>
              <div class="analytics-view__stat">
                <span class="analytics-view__stat-value">
                  {analyticsState.summary!.onTimePercent.toFixed(0)}%
                </span>
                <span class="analytics-view__stat-label">A l'heure (≤ 5 min)</span>
              </div>
              <div class="analytics-view__stat">
                <span class="analytics-view__stat-value">
                  {formatNetworkDelay(analyticsState.summary!.avgNetworkDelay)}
                </span>
                <span class="analytics-view__stat-label">Retard moyen actuel</span>
              </div>
              <div class="analytics-view__stat">
                <span class="analytics-view__stat-value">
                  {analyticsState.summary!.activeAlerts}
                </span>
                <span class="analytics-view__stat-label">Alertes reseau</span>
              </div>
            </section>
          </Show>

          <Show when={analyticsState.delayByHour.length > 0}>
            <section class="analytics-view__section">
              <h2>Retard moyen par heure (7 derniers jours)</h2>
              <DelayChart data={analyticsState.delayByHour} />
            </section>
          </Show>

          <Show when={reliabilityWithNames().length > 0}>
            <div class="analytics-view__two-cols">
              <section class="analytics-view__section">
                <h2>Top 5 — Lignes les plus fiables</h2>
                <ul class="analytics-view__ranking">
                  <For each={bestLines()}>
                    {(item) => (
                      <li class="analytics-view__ranking-item">
                        <span
                          class="analytics-view__line-badge"
                          style={{
                            "background-color": item.line?.color ?? "#6c63ff",
                            color: item.line?.textColor ?? "#fff",
                          }}
                        >
                          {item.line?.shortName ?? "?"}
                        </span>
                        <span class="analytics-view__line-name">
                          {item.line?.longName ?? item.routeId}
                        </span>
                        <span class="analytics-view__line-pct analytics-view__line-pct--good">
                          {item.onTimePercent}%
                        </span>
                      </li>
                    )}
                  </For>
                </ul>
              </section>

              <section class="analytics-view__section">
                <h2>Top 5 — Lignes les moins fiables</h2>
                <ul class="analytics-view__ranking">
                  <For each={worstLines()}>
                    {(item) => (
                      <li class="analytics-view__ranking-item">
                        <span
                          class="analytics-view__line-badge"
                          style={{
                            "background-color": item.line?.color ?? "#6c63ff",
                            color: item.line?.textColor ?? "#fff",
                          }}
                        >
                          {item.line?.shortName ?? "?"}
                        </span>
                        <span class="analytics-view__line-name">
                          {item.line?.longName ?? item.routeId}
                        </span>
                        <span
                          class="analytics-view__line-pct"
                          classList={{
                            "analytics-view__line-pct--bad": item.onTimePercent < 70,
                            "analytics-view__line-pct--warn": item.onTimePercent >= 70 && item.onTimePercent < 85,
                          }}
                        >
                          {item.onTimePercent}%
                        </span>
                      </li>
                    )}
                  </For>
                </ul>
              </section>
            </div>
          </Show>

          <Show when={reliabilityWithNames().length === 0}>
            <section class="analytics-view__section">
              <p class="analytics-view__empty">
                Pas encore assez de donnees pour afficher la fiabilite. Les snapshots sont collectes toutes les 60 secondes — revenez dans quelques heures.
              </p>
            </section>
          </Show>
        </div>
      </Show>
    </div>
  );
};

export default AnalyticsView;
