export function parseGtfsTime(timeStr: string, serviceDate: string): number {
  const parts = timeStr.trim().split(":");
  const hours = parseInt(parts[0] ?? "0", 10);
  const minutes = parseInt(parts[1] ?? "0", 10);
  const seconds = parseInt(parts[2] ?? "0", 10);

  const base = new Date(`${serviceDate}T00:00:00`);
  return base.getTime() + (hours * 3600 + minutes * 60 + seconds) * 1000;
}

export function formatDelay(seconds: number): string {
  if (seconds === 0) return "on time";
  const abs = Math.abs(seconds);
  const min = Math.floor(abs / 60);
  const sec = abs % 60;
  const sign = seconds > 0 ? "+" : "-";

  if (min === 0) return `${sign}${sec}s`;
  if (sec === 0) return `${sign}${min}min`;
  return `${sign}${min}min ${sec}s`;
}

export function getCurrentServiceDate(): string {
  const now = new Date();
  if (now.getHours() < 4) {
    now.setDate(now.getDate() - 1);
  }
  return now.toISOString().slice(0, 10);
}

export function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}
