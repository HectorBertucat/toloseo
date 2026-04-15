import { type Component, createMemo } from "solid-js";

interface TrendBadgeProps {
  direction: "up" | "down" | "stable";
}

const TREND_CONFIG = {
  up: { symbol: "\u2191", label: "En hausse", className: "trend-badge--up" },
  down: {
    symbol: "\u2193",
    label: "En baisse",
    className: "trend-badge--down",
  },
  stable: {
    symbol: "\u2192",
    label: "Stable",
    className: "trend-badge--stable",
  },
} as const;

const TrendBadge: Component<TrendBadgeProps> = (props) => {
  const config = createMemo(() => TREND_CONFIG[props.direction]);

  return (
    <span
      class={`trend-badge badge ${config().className}`}
      title={config().label}
      aria-label={config().label}
    >
      <span aria-hidden="true">{config().symbol}</span>
      {config().label}
    </span>
  );
};

export default TrendBadge;
