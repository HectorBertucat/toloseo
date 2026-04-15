import type { SSEEvent, BBox } from "@shared/types";
import { handleSSEEvent, setConnectionStatus } from "../stores/transit";

const MAX_RETRIES = 8;
const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 30000;

let eventSource: EventSource | null = null;
let retryCount = 0;
let retryTimeout: ReturnType<typeof setTimeout> | null = null;
let currentBBox: BBox | undefined;
let isConnecting = false;

function buildStreamUrl(bbox?: BBox): string {
  const url = new URL("/api/stream", window.location.origin);
  if (bbox) {
    url.searchParams.set("bbox", `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`);
  }
  return url.toString();
}

function getBackoffDelay(): number {
  const delay = Math.min(BASE_DELAY_MS * Math.pow(2, retryCount), MAX_DELAY_MS);
  const jitter = delay * 0.3 * Math.random();
  return delay + jitter;
}

function parseEvent(data: string): SSEEvent | null {
  try {
    return JSON.parse(data) as SSEEvent;
  } catch {
    return null;
  }
}

function connect(bbox?: BBox): void {
  if (isConnecting) return;
  closeExisting();
  isConnecting = true;
  currentBBox = bbox;
  setConnectionStatus("connecting");

  const url = buildStreamUrl(bbox);
  eventSource = new EventSource(url);

  eventSource.onopen = () => {
    retryCount = 0;
    isConnecting = false;
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
    isConnecting = false;
    setConnectionStatus("error");
    closeExisting();
    scheduleReconnect();
  };
}

function scheduleReconnect(): void {
  if (retryCount >= MAX_RETRIES) {
    setConnectionStatus("disconnected");
    return;
  }

  const delay = getBackoffDelay();
  retryCount++;

  retryTimeout = setTimeout(() => {
    connect(currentBBox);
  }, delay);
}

function closeExisting(): void {
  if (retryTimeout) {
    clearTimeout(retryTimeout);
    retryTimeout = null;
  }
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

function disconnect(): void {
  closeExisting();
  retryCount = 0;
  isConnecting = false;
  setConnectionStatus("disconnected");
}

function updateBBox(bbox: BBox): void {
  currentBBox = bbox;
  // Only reconnect if already connected, don't reset retry count
  if (eventSource && eventSource.readyState === EventSource.OPEN) {
    closeExisting();
    connect(bbox);
  }
}

export { connect, disconnect, updateBBox };
