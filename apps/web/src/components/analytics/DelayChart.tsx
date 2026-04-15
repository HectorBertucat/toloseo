import { type Component, For, createMemo, Show } from "solid-js";
import type { DelayByHour } from "@shared/types";

interface DelayChartProps {
  data: DelayByHour[];
}

const DelayChart: Component<DelayChartProps> = (props) => {
  const maxDelay = createMemo(() => {
    if (props.data.length === 0) return 1;
    return Math.max(...props.data.map((d) => d.avgDelay), 1);
  });

  return (
    <div class="delay-chart">
      <Show
        when={props.data.length > 0}
        fallback={<p class="delay-chart__empty">Aucune donnee</p>}
      >
        <div class="delay-chart__bars">
          <For each={props.data}>
            {(item) => {
              const pct = () =>
                Math.max((item.avgDelay / maxDelay()) * 100, 2);
              const color = () =>
                item.avgDelay < 60
                  ? "var(--color-on-time)"
                  : item.avgDelay < 180
                    ? "var(--color-minor-delay)"
                    : "var(--color-major-delay)";

              return (
                <div class="delay-chart__bar-group">
                  <div class="delay-chart__bar-container">
                    <div
                      class="delay-chart__bar"
                      style={{
                        width: `${pct()}%`,
                        "background-color": color(),
                      }}
                    />
                  </div>
                  <span class="delay-chart__label">
                    {String(item.hour).padStart(2, "0")}h
                  </span>
                  <span class="delay-chart__value">{item.avgDelay}s</span>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
};

export default DelayChart;
