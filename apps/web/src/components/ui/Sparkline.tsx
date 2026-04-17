import { type Component, Show, createMemo } from "solid-js";

interface SparklineProps {
  values: number[]; // 0..1 (reliability ratio) or arbitrary series
  width?: number;
  height?: number;
  color?: string;
  ariaLabel?: string;
}

/**
 * Tiny, dependency-free inline SVG sparkline. Renders a polyline + end-dot.
 * Resolves actual color from CSS custom properties at render time so themes
 * and line tints work without JS wiring.
 */
const Sparkline: Component<SparklineProps> = (props) => {
  const width = () => props.width ?? 60;
  const height = () => props.height ?? 16;
  const stroke = () => props.color ?? "var(--color-accent)";

  const path = createMemo(() => {
    const v = props.values;
    if (v.length < 2) return "";
    const w = width();
    const h = height();
    const min = Math.min(...v);
    const max = Math.max(...v);
    const range = max - min || 1;
    const step = w / (v.length - 1);
    return v
      .map((val, i) => {
        const x = i * step;
        const y = h - 2 - ((val - min) / range) * (h - 4);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
  });

  const endPoint = createMemo(() => {
    const v = props.values;
    if (v.length === 0) return null;
    const w = width();
    const h = height();
    const min = Math.min(...v);
    const max = Math.max(...v);
    const range = max - min || 1;
    const last = v[v.length - 1]!;
    return {
      x: w - 1,
      y: h - 2 - ((last - min) / range) * (h - 4),
    };
  });

  return (
    <Show when={props.values.length >= 2}>
      <svg
        class="sparkline"
        width={width()}
        height={height()}
        viewBox={`0 0 ${width()} ${height()}`}
        role={props.ariaLabel ? "img" : "presentation"}
        aria-label={props.ariaLabel}
      >
        <path
          d={path()}
          fill="none"
          stroke={stroke()}
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          opacity="0.85"
        />
        <Show when={endPoint()}>
          <circle
            cx={endPoint()!.x}
            cy={endPoint()!.y}
            r="1.8"
            fill={stroke()}
          />
        </Show>
      </svg>
    </Show>
  );
};

export default Sparkline;
