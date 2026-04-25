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
import DistributionBar from "./DistributionBar";
import Sparkline from "../ui/Sparkline";
import Skeleton from "../ui/Skeleton";
import { pickReadableTextColor } from "../../utils/contrast";
import type { DelayDistribution } from "@shared/types";
import "../../styles/components/analytics.css";

function formatNetworkDelay(seconds: number): string {
  if (seconds === 0) return "à l'heure";
  const abs = Math.abs(seconds);
  const sign = seconds > 0 ? "+" : "−";
  if (abs < 60) return `${sign}${abs}s`;
  const minutes = Math.round(abs / 60);
  return `${sign}${minutes} min`;
}

function emptyDistribution(): DelayDistribution {
  return { veryEarly: 0, early: 0, onTime: 0, late: 0, veryLate: 0 };
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

  // Aggregated network distribution: sum every route's bucket counts so
  // we can show one stacked bar that captures the whole system, not just
  // the unweighted average. Median falls out naturally — pick the bucket
  // mid-point holding the half-sample mark.
  const networkDistribution = createMemo<DelayDistribution>(() => {
    const acc = emptyDistribution();
    for (const r of analyticsState.reliability) {
      const d = r.distribution;
      if (!d) continue;
      acc.veryEarly += d.veryEarly;
      acc.early += d.early;
      acc.onTime += d.onTime;
      acc.late += d.late;
      acc.veryLate += d.veryLate;
    }
    return acc;
  });

  const networkMedian = createMemo<number>(() => {
    const d = networkDistribution();
    const total = d.veryEarly + d.early + d.onTime + d.late + d.veryLate;
    if (total === 0) return 0;
    const half = total / 2;
    let acc = 0;
    const buckets: [number, number][] = [
      [-600, d.veryEarly],
      [-180, d.early],
      [60, d.onTime],
      [450, d.late],
      [900, d.veryLate],
    ];
    for (const [mid, count] of buckets) {
      acc += count;
      if (acc >= half) return mid;
    }
    return 0;
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
                <span class="analytics-view__stat-value tabular">
                  {analyticsState.summary!.activeVehicles}
                </span>
                <span class="analytics-view__stat-label">
                  Véhicules actifs
                </span>
              </div>
              <div class="analytics-view__stat">
                <span class="analytics-view__stat-value tabular">
                  {analyticsState.summary!.onTimePercent.toFixed(0)}%
                </span>
                <span class="analytics-view__stat-label">À l'heure (−1 à +5 min)</span>
              </div>
              <div class="analytics-view__stat">
                <span class="analytics-view__stat-value tabular">
                  {formatNetworkDelay(networkMedian())}
                </span>
                <span class="analytics-view__stat-label">
                  Médiane réseau
                  <span class="analytics-view__stat-sub tabular">
                    (moy. {formatNetworkDelay(analyticsState.summary!.avgNetworkDelay)})
                  </span>
                </span>
              </div>
              <div class="analytics-view__stat">
                <span class="analytics-view__stat-value tabular">
                  {analyticsState.summary!.activeAlerts}
                </span>
                <span class="analytics-view__stat-label">Alertes réseau</span>
              </div>
            </section>
          </Show>

          <Show
            when={
              networkDistribution().veryEarly +
                networkDistribution().early +
                networkDistribution().onTime +
                networkDistribution().late +
                networkDistribution().veryLate >
              0
            }
          >
            <section class="analytics-view__section">
              <h2>Distribution des retards réseau</h2>
              <DistributionBar
                distribution={networkDistribution()}
                ariaLabel="Distribution des retards sur le réseau (7 derniers jours)"
              />
            </section>
          </Show>

          <Show when={analyticsState.trends.length >= 2}>
            <section class="analytics-view__section analytics-view__hero">
              <div class="analytics-view__hero-head">
                <h2>Tendance ponctualite (7 jours)</h2>
                <span class="analytics-view__hero-stat">
                  {analyticsState.trends[analyticsState.trends.length - 1]
                    ?.onTimePercent.toFixed(0)}
                  %
                </span>
              </div>
              <Sparkline
                values={analyticsState.trends.map((t) => t.onTimePercent)}
                width={320}
                height={48}
                ariaLabel="Ponctualite des 7 derniers jours"
              />
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
                            "background-color": item.line?.color ?? "#e86b5c",
                            color: pickReadableTextColor(
                              item.line?.color ?? "#e86b5c",
                              item.line?.textColor ?? null,
                            ),
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
                            "background-color": item.line?.color ?? "#e86b5c",
                            color: pickReadableTextColor(
                              item.line?.color ?? "#e86b5c",
                              item.line?.textColor ?? null,
                            ),
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
