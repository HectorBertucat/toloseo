import { type Component, For, createMemo, Show } from "solid-js";
import type { DelayByHour } from "@shared/types";

interface DelayChartProps {
  data: DelayByHour[];
}

const DelayChart: Component<DelayChartProps> = (props) => {
  // Max absolute delay in the set drives the bar scale.
  const maxAbs = createMemo(() => {
    if (props.data.length === 0) return 60;
    const max = Math.max(...props.data.map((d) => Math.abs(d.avgDelay)), 30);
    return Math.max(max, 60);
  });

  function formatSeconds(s: number): string {
    if (s === 0) return "0";
    const sign = s > 0 ? "+" : "−";
    const abs = Math.abs(s);
    if (abs < 60) return `${sign}${abs}s`;
    const m = Math.round(abs / 60);
    return `${sign}${m} min`;
  }

  function severity(seconds: number): string {
    const abs = Math.abs(seconds);
    if (abs < 60) return "ok";
    if (abs < 180) return "warn";
    return "bad";
  }

  return (
    <div class="delay-chart">
      <Show
        when={props.data.length > 0}
        fallback={
          <p class="delay-chart__empty">
            Pas encore assez de données temps-réel pour ce graphique.
          </p>
        }
      >
        <div class="delay-chart__rows">
          <For each={props.data}>
            {(item) => {
              const pct = () =>
                Math.min((Math.abs(item.avgDelay) / maxAbs()) * 50, 50);
              const sign = () => (item.avgDelay >= 0 ? "right" : "left");
              return (
                <div class="delay-chart__row">
                  <span class="delay-chart__hour">
                    {String(item.hour).padStart(2, "0")}h
                  </span>
                  <div class="delay-chart__track">
                    <div class="delay-chart__axis" />
                    <div
                      classList={{
                        "delay-chart__bar": true,
                        [`delay-chart__bar--${sign()}`]: true,
                        [`delay-chart__bar--${severity(item.avgDelay)}`]: true,
                      }}
                      style={{ width: `${pct()}%` }}
                    />
                  </div>
                  <span class="delay-chart__value" title={`${item.sampleCount} échantillons`}>
                    {formatSeconds(item.avgDelay)}
                  </span>
                </div>
              );
            }}
          </For>
        </div>
        <div class="delay-chart__legend">
          <span class="delay-chart__legend-item"><span class="delay-chart__legend-dot delay-chart__legend-dot--early" /> En avance</span>
          <span class="delay-chart__legend-item"><span class="delay-chart__legend-dot delay-chart__legend-dot--ok" /> À l'heure</span>
          <span class="delay-chart__legend-item"><span class="delay-chart__legend-dot delay-chart__legend-dot--late" /> En retard</span>
        </div>
      </Show>
    </div>
  );
};

export default DelayChart;
