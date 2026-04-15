import { type Component, onMount, Show } from "solid-js";
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
} from "../../services/api";
import DelayChart from "./DelayChart";
import ReliabilityCard from "./ReliabilityCard";
import Skeleton from "../ui/Skeleton";
import "../../styles/components/analytics.css";

const AnalyticsView: Component = () => {
  onMount(async () => {
    setLoading(true);
    setError(null);
    try {
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

  return (
    <div class="analytics-view">
      <header class="analytics-view__header">
        <h1>Analytique du reseau</h1>
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
            <div class="analytics-view__summary">
              <div class="analytics-view__stat">
                <span class="analytics-view__stat-value">
                  {analyticsState.summary!.activeVehicles}
                </span>
                <span class="analytics-view__stat-label">
                  Vehicules actifs
                </span>
              </div>
              <div class="analytics-view__stat">
                <span class="analytics-view__stat-value">
                  {analyticsState.summary!.onTimePercent.toFixed(1)}%
                </span>
                <span class="analytics-view__stat-label">A l'heure</span>
              </div>
              <div class="analytics-view__stat">
                <span class="analytics-view__stat-value">
                  {analyticsState.summary!.avgNetworkDelay}s
                </span>
                <span class="analytics-view__stat-label">Retard moyen</span>
              </div>
              <div class="analytics-view__stat">
                <span class="analytics-view__stat-value">
                  {analyticsState.summary!.activeAlerts}
                </span>
                <span class="analytics-view__stat-label">Alertes</span>
              </div>
            </div>
          </Show>

          <section class="analytics-view__section">
            <h2>Retard par heure</h2>
            <DelayChart data={analyticsState.delayByHour} />
          </section>

          <section class="analytics-view__section">
            <h2>Fiabilite par ligne</h2>
            <div class="analytics-view__reliability-grid">
              {analyticsState.reliability.map((score) => (
                <ReliabilityCard score={score} />
              ))}
            </div>
          </section>
        </div>
      </Show>
    </div>
  );
};

export default AnalyticsView;
