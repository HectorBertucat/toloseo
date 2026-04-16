/**
 * Format a timestamp (in milliseconds, as returned by the backend) to HH:MM.
 * The backend returns epoch millis; SSE vehicle timestamps are unix seconds
 * and should pass `timestamp * 1000` at the call site.
 */
function formatTime(timestampMs: number): string {
  const date = new Date(timestampMs);
  return date.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDelay(delaySeconds: number): string {
  if (delaySeconds === 0) return "a l'heure";

  const absDelay = Math.abs(delaySeconds);
  const sign = delaySeconds > 0 ? "+" : "-";

  if (absDelay < 60) {
    return `${sign}${absDelay}s`;
  }

  const minutes = Math.floor(absDelay / 60);
  const seconds = absDelay % 60;

  if (seconds === 0) {
    return `${sign}${minutes}min`;
  }

  return `${sign}${minutes}min${seconds}s`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes < 60) {
    return remainingSeconds > 0
      ? `${minutes}min ${remainingSeconds}s`
      : `${minutes}min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return remainingMinutes > 0
    ? `${hours}h ${remainingMinutes}min`
    : `${hours}h`;
}

function delayColor(delaySeconds: number): string {
  const absDelay = Math.abs(delaySeconds);
  if (absDelay < 60) return "#22c55e";
  if (absDelay < 300) return "#f59e0b";
  return "#ef4444";
}

/**
 * Countdown-style formatting for an upcoming arrival.
 *   - <60s   -> "Now"
 *   - <20min -> "5 min"
 *   - >=20min -> "14:52"
 */
function formatCountdown(arrivalMs: number, nowMs: number = Date.now()): string {
  const diffSec = Math.round((arrivalMs - nowMs) / 1000);
  if (diffSec < 60) return "Now";

  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 20) return `${diffMin} min`;

  return new Date(arrivalMs).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Signed delta in minutes for the "+3 min" style delay badge.
 * Returns null for |delay| < 30s (treated as "on time").
 */
function formatDelayDelta(delaySeconds: number): string | null {
  if (Math.abs(delaySeconds) < 30) return null;
  const minutes = Math.round(delaySeconds / 60);
  if (minutes === 0) {
    const sign = delaySeconds > 0 ? "+" : "-";
    return `${sign}${Math.abs(delaySeconds)}s`;
  }
  const sign = minutes > 0 ? "+" : "";
  return `${sign}${minutes} min`;
}

export {
  formatTime,
  formatDelay,
  formatDuration,
  delayColor,
  formatCountdown,
  formatDelayDelta,
};
