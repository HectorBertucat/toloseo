import type { SSEEvent, BBox } from "@shared/types";
import { handleSSEEvent, setConnectionStatus } from "../stores/transit";

const MAX_RETRIES = 10;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;

let eventSource: EventSource | null = null;
let retryCount = 0;
let retryTimeout: ReturnType<typeof setTimeout> | null = null;

function buildStreamUrl(bbox?: BBox): string {
  const url = new URL("/api/stream", window.location.origin);
  if (bbox) {
    url.searchParams.set("bbox", `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`);
  }
  return url.toString();
}

function getBackoffDelay(): number {
  const delay = Math.min(BASE_DELAY_MS * Math.pow(2, retryCount), MAX_DELAY_MS);
  const jitter = delay * 0.2 * Math.random();
  return delay + jitter;
}

function parseEvent(data: string): SSEEvent | null {
  try {
    return JSON.parse(data) as SSEEvent;
  } catch {
    console.warn("Failed to parse SSE event:", data);
    return null;
  }
}

function connect(bbox?: BBox): void {
  disconnect();
  setConnectionStatus("connecting");

  const url = buildStreamUrl(bbox);
  eventSource = new EventSource(url);

  eventSource.onopen = () => {
    retryCount = 0;
    setConnectionStatus("connected");
  };

  const handleEvent = (event: MessageEvent<string>) => {
    const parsed = parseEvent(event.data);
    if (parsed) handleSSEEvent(parsed);
  };

  eventSource.addEventListener("init", handleEvent);
  eventSource.addEventListener("vehicles", handleEvent);
  eventSource.addEventListener("alerts", handleEvent);
  eventSource.addEventListener("heartbeat", handleEvent);

  eventSource.onerror = () => {
    setConnectionStatus("error");
    eventSource?.close();
    eventSource = null;
    scheduleReconnect(bbox);
  };
}

function scheduleReconnect(bbox?: BBox): void {
  if (retryCount >= MAX_RETRIES) {
    setConnectionStatus("disconnected");
    return;
  }

  const delay = getBackoffDelay();
  retryCount++;

  retryTimeout = setTimeout(() => {
    connect(bbox);
  }, delay);
}

function disconnect(): void {
  if (retryTimeout) {
    clearTimeout(retryTimeout);
    retryTimeout = null;
  }
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  retryCount = 0;
  setConnectionStatus("disconnected");
}

function updateBBox(bbox: BBox): void {
  const wasConnected = eventSource !== null;
  if (wasConnected) {
    connect(bbox);
  }
}

export { connect, disconnect, updateBBox };
