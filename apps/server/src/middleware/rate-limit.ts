import type { MiddlewareHandler } from "hono";
import { logger } from "../logger.js";

interface RateBucket {
  count: number;
  resetAt: number;
}

const ipBuckets = new Map<string, RateBucket>();
const sseConnections = new Map<string, number>();

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 60;
const MAX_SSE = 5;

function cleanExpiredBuckets(): void {
  const now = Date.now();
  for (const [ip, bucket] of ipBuckets) {
    if (bucket.resetAt <= now) ipBuckets.delete(ip);
  }
}

setInterval(cleanExpiredBuckets, WINDOW_MS);

function getClientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
    ?? c.req.header("x-real-ip")
    ?? "unknown";
}

export function rateLimit(): MiddlewareHandler {
  return async (c, next) => {
    const ip = getClientIp(c);
    const now = Date.now();

    let bucket = ipBuckets.get(ip);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + WINDOW_MS };
      ipBuckets.set(ip, bucket);
    }

    bucket.count++;

    if (bucket.count > MAX_REQUESTS) {
      logger.warn({ ip, count: bucket.count }, "rate limit exceeded");
      c.header("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      return c.json({ ok: false, error: "Too many requests", timestamp: now }, 429);
    }

    await next();
  };
}

export function acquireSseSlot(ip: string): boolean {
  const current = sseConnections.get(ip) ?? 0;
  if (current >= MAX_SSE) return false;
  sseConnections.set(ip, current + 1);
  return true;
}

export function releaseSseSlot(ip: string): void {
  const current = sseConnections.get(ip) ?? 0;
  if (current <= 1) {
    sseConnections.delete(ip);
  } else {
    sseConnections.set(ip, current - 1);
  }
}

export function getClientIpFromHeader(
  headerFn: (name: string) => string | undefined,
): string {
  return headerFn("x-forwarded-for")?.split(",")[0]?.trim()
    ?? headerFn("x-real-ip")
    ?? "unknown";
}
