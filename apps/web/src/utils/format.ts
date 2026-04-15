function formatTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
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

export { formatTime, formatDelay, formatDuration, delayColor };
