import { type Component, createMemo } from "solid-js";
import type { ReliabilityScore } from "@shared/types";
import TrendBadge from "./TrendBadge";

interface ReliabilityCardProps {
  score: ReliabilityScore;
}

const ReliabilityCard: Component<ReliabilityCardProps> = (props) => {
  const reliabilityColor = createMemo(() => {
    const pct = props.score.onTimePercent;
    if (pct >= 90) return "var(--color-on-time)";
    if (pct >= 75) return "var(--color-minor-delay)";
    return "var(--color-major-delay)";
  });

  const trend = createMemo((): "up" | "down" | "stable" => {
    const avg = props.score.avgDelay;
    if (avg < 30) return "up";
    if (avg > 120) return "down";
    return "stable";
  });

  return (
    <div class="reliability-card glass">
      <div class="reliability-card__header">
        <span class="reliability-card__route">{props.score.routeId}</span>
        <TrendBadge direction={trend()} />
      </div>
      <div class="reliability-card__score">
        <span
          class="reliability-card__percent"
          style={{ color: reliabilityColor() }}
        >
          {props.score.onTimePercent.toFixed(1)}%
        </span>
        <span class="reliability-card__label">a l'heure</span>
      </div>
      <div class="reliability-card__details">
        <div class="reliability-card__detail">
          <span class="reliability-card__detail-label">Retard moy.</span>
          <span class="reliability-card__detail-value">
            {props.score.avgDelay}s
          </span>
        </div>
        <div class="reliability-card__detail">
          <span class="reliability-card__detail-label">Retard max</span>
          <span class="reliability-card__detail-value">
            {props.score.maxDelay}s
          </span>
        </div>
        <div class="reliability-card__detail">
          <span class="reliability-card__detail-label">Trajets</span>
          <span class="reliability-card__detail-value">
            {props.score.totalTrips}
          </span>
        </div>
      </div>
    </div>
  );
};

export default ReliabilityCard;
