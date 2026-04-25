import { type Component, For, createMemo } from "solid-js";
import type { DelayDistribution } from "@shared/types";

interface DistributionBarProps {
  distribution: DelayDistribution;
  /** Optional accessible label, e.g. "Distribution réseau". */
  ariaLabel?: string;
}

interface Bucket {
  key: keyof DelayDistribution;
  label: string;
  short: string;
  color: string;
}

/* Order mirrors the visual reading direction: most early → most late.
   Colors map to the existing delay palette + cool tones for "early"
   (no semantic state token for early in variables.css).            */
const BUCKETS: Bucket[] = [
  {
    key: "veryEarly",
    label: "Très en avance (>5 min)",
    short: "≪ −5 min",
    color: "#3b82f6",
  },
  {
    key: "early",
    label: "En avance (1 à 5 min)",
    short: "−1 à −5 min",
    color: "#60a5fa",
  },
  {
    key: "onTime",
    label: "À l'heure (−1 à +5 min)",
    short: "À l'heure",
    color: "var(--color-on-time)",
  },
  {
    key: "late",
    label: "En retard (5 à 10 min)",
    short: "+5 à +10 min",
    color: "var(--color-minor-delay)",
  },
  {
    key: "veryLate",
    label: "Très en retard (>10 min)",
    short: "≫ +10 min",
    color: "var(--color-major-delay)",
  },
];

const DistributionBar: Component<DistributionBarProps> = (p) => {
  const total = createMemo(() => {
    const d = p.distribution;
    return d.veryEarly + d.early + d.onTime + d.late + d.veryLate;
  });

  const slices = createMemo(() => {
    const d = p.distribution;
    const t = total();
    if (t === 0) return [];
    return BUCKETS.map((b) => ({
      ...b,
      count: d[b.key],
      percent: (d[b.key] / t) * 100,
    })).filter((s) => s.percent > 0);
  });

  return (
    <div
      class="distribution-bar"
      role="img"
      aria-label={p.ariaLabel ?? "Distribution des retards"}
    >
      <div class="distribution-bar__track">
        <For each={slices()}>
          {(s) => (
            <span
              class="distribution-bar__slice"
              style={{
                width: `${s.percent}%`,
                "background-color": s.color,
              }}
              title={`${s.label} — ${s.percent.toFixed(0)}%`}
            />
          )}
        </For>
      </div>
      <ul class="distribution-bar__legend">
        <For each={BUCKETS}>
          {(b) => {
            const count = p.distribution[b.key];
            const pct = total() > 0 ? (count / total()) * 100 : 0;
            return (
              <li class="distribution-bar__legend-item">
                <span
                  class="distribution-bar__swatch"
                  style={{ "background-color": b.color }}
                  aria-hidden="true"
                />
                <span class="distribution-bar__legend-label">{b.short}</span>
                <span class="distribution-bar__legend-pct tabular">
                  {pct.toFixed(0)}%
                </span>
              </li>
            );
          }}
        </For>
      </ul>
    </div>
  );
};

export default DistributionBar;
