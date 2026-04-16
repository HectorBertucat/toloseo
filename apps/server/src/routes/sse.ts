import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getVehicles, getAlerts } from "../gtfs/store.js";
import { isInBbox, parseBbox } from "../utils/geo.js";
import { logger } from "../logger.js";
import {
  acquireSseSlot,
  releaseSseSlot,
  getClientIpFromHeader,
} from "../middleware/rate-limit.js";
import type { Vehicle, BBox, SSEInitEvent, SSEVehicleEvent, SSEAlertEvent, SSEHeartbeatEvent } from "@shared/types.js";

const HEARTBEAT_INTERVAL_MS = 30_000;
const POLL_INTERVAL_MS = 2_000;

interface SseClient {
  id: string;
  bbox: BBox | null;
  lastVehicleState: Map<string, string>;
  lastAlertHash: string;
}

export function registerSseRoutes(app: Hono): void {
  app.get("/api/stream", (c) => {
    const bboxRaw = c.req.query("bbox");
    const bbox = bboxRaw ? parseBbox(bboxRaw) : null;

    return streamSSE(c, async (stream) => {
      const client: SseClient = {
        id: crypto.randomUUID(),
        bbox,
        lastVehicleState: new Map(),
        lastAlertHash: "",
      };

      logger.debug({ clientId: client.id, bbox }, "SSE client connected");

      try {
        await sendInitEvent(stream, client);
        await runEventLoop(stream, client);
      } catch (err) {
        if (!isConnectionClosed(err)) {
          logger.error({ err, clientId: client.id }, "SSE stream error");
        }
      } finally {
        logger.debug({ clientId: client.id }, "SSE client disconnected");
      }
    });
  });
}

async function sendInitEvent(
  stream: { writeSSE: (event: { event: string; data: string }) => Promise<void> },
  client: SseClient,
): Promise<void> {
  const vehicles = getFilteredVehicles(client.bbox);
  const alerts = getAlerts();

  for (const v of vehicles) {
    client.lastVehicleState.set(v.id, vehicleHash(v));
  }
  client.lastAlertHash = simpleHash(JSON.stringify(alerts));

  const event: SSEInitEvent = {
    type: "init",
    vehicles,
    alerts,
    timestamp: Date.now(),
  };

  await stream.writeSSE({ event: "init", data: JSON.stringify(event) });
}

async function runEventLoop(
  stream: { writeSSE: (event: { event: string; data: string }) => Promise<void> },
  client: SseClient,
): Promise<void> {
  let lastHeartbeat = Date.now();
  let running = true;

  while (running) {
    await sleep(POLL_INTERVAL_MS);
    const now = Date.now();

    await sendVehicleDelta(stream, client);
    await sendAlertDelta(stream, client);

    if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
      const hb: SSEHeartbeatEvent = { type: "heartbeat", timestamp: now };
      await stream.writeSSE({ event: "heartbeat", data: JSON.stringify(hb) });
      lastHeartbeat = now;
    }
  }
}

async function sendVehicleDelta(
  stream: { writeSSE: (event: { event: string; data: string }) => Promise<void> },
  client: SseClient,
): Promise<void> {
  const current = getFilteredVehicles(client.bbox);
  const currentIds = new Set(current.map((v) => v.id));
  const updated: Vehicle[] = [];
  const removed: string[] = [];

  for (const v of current) {
    const hash = vehicleHash(v);
    if (client.lastVehicleState.get(v.id) !== hash) {
      updated.push(v);
      client.lastVehicleState.set(v.id, hash);
    }
  }

  for (const [id] of client.lastVehicleState) {
    if (!currentIds.has(id)) {
      removed.push(id);
      client.lastVehicleState.delete(id);
    }
  }

  if (updated.length === 0 && removed.length === 0) return;

  const event: SSEVehicleEvent = {
    type: "vehicles",
    updated,
    removed,
    timestamp: Date.now(),
  };

  await stream.writeSSE({ event: "vehicles", data: JSON.stringify(event) });
}

async function sendAlertDelta(
  stream: { writeSSE: (event: { event: string; data: string }) => Promise<void> },
  client: SseClient,
): Promise<void> {
  const alerts = getAlerts();
  const hash = simpleHash(JSON.stringify(alerts));

  if (hash === client.lastAlertHash) return;
  client.lastAlertHash = hash;

  const event: SSEAlertEvent = {
    type: "alerts",
    alerts,
    timestamp: Date.now(),
  };

  await stream.writeSSE({ event: "alerts", data: JSON.stringify(event) });
}

function getFilteredVehicles(bbox: BBox | null): Vehicle[] {
  const vehicles = Array.from(getVehicles().values());
  if (!bbox) return vehicles;
  return vehicles.filter((v) => isInBbox(v.lat, v.lon, bbox));
}

function vehicleHash(v: Vehicle): string {
  return `${v.lat.toFixed(6)},${v.lon.toFixed(6)},${v.bearing.toFixed(0)},${v.delay},${v.stopSequence}`;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return hash.toString(36);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isConnectionClosed(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return msg.includes("aborted") || msg.includes("closed") || msg.includes("reset");
  }
  return false;
}
