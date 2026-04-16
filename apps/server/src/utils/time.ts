const AGENCY_TIMEZONE = "Europe/Paris";

/**
 * Paris-local midnight of the given service date (YYYY-MM-DD), in UTC ms.
 * Works regardless of the server's TZ — GTFS times are always agency-local.
 */
function parisMidnightMs(serviceDate: string): number {
  const approxUtc = Date.parse(`${serviceDate}T00:00:00Z`);
  if (Number.isNaN(approxUtc)) return 0;
  const offsetMin = parisOffsetMinutes(approxUtc);
  return approxUtc - offsetMin * 60_000;
}

function parisOffsetMinutes(utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: AGENCY_TIMEZONE,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));

  const p: Record<string, string> = {};
  for (const part of parts) p[part.type] = part.value;

  const hour = p["hour"] === "24" ? 0 : parseInt(p["hour"] ?? "0", 10);
  const parisLocalMs = Date.UTC(
    parseInt(p["year"] ?? "0", 10),
    parseInt(p["month"] ?? "1", 10) - 1,
    parseInt(p["day"] ?? "1", 10),
    hour,
    parseInt(p["minute"] ?? "0", 10),
    parseInt(p["second"] ?? "0", 10),
  );
  return (parisLocalMs - utcMs) / 60_000;
}

export function parseGtfsTime(timeStr: string, serviceDate: string): number {
  const parts = timeStr.trim().split(":");
  const hours = parseInt(parts[0] ?? "0", 10);
  const minutes = parseInt(parts[1] ?? "0", 10);
  const seconds = parseInt(parts[2] ?? "0", 10);

  return parisMidnightMs(serviceDate) + (hours * 3600 + minutes * 60 + seconds) * 1000;
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
  // Compute current wall-clock time in Europe/Paris so the "service day"
  // boundary rolls at 04:00 Paris regardless of server TZ.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: AGENCY_TIMEZONE,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
  }).formatToParts(new Date());

  const p: Record<string, string> = {};
  for (const part of parts) p[part.type] = part.value;

  const year = parseInt(p["year"] ?? "1970", 10);
  const month = parseInt(p["month"] ?? "1", 10) - 1;
  const day = parseInt(p["day"] ?? "1", 10);
  const hour = p["hour"] === "24" ? 0 : parseInt(p["hour"] ?? "0", 10);

  const d = new Date(Date.UTC(year, month, day));
  if (hour < 4) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}
