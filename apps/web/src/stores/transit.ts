import { createStore, produce } from "solid-js/store";
import type {
  TransitLine,
  Vehicle,
  Stop,
  Alert,
  SSEEvent,
} from "@shared/types";

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

interface TransitState {
  lines: TransitLine[];
  vehicles: Record<string, Vehicle>;
  stops: Record<string, Stop>;
  alerts: Alert[];
  connectionStatus: ConnectionStatus;
  lastUpdate: number;
}

const initialState: TransitState = {
  lines: [],
  vehicles: {},
  stops: {},
  alerts: [],
  connectionStatus: "disconnected",
  lastUpdate: 0,
};

const [transitState, setTransitState] = createStore<TransitState>(initialState);

function setConnectionStatus(status: ConnectionStatus): void {
  setTransitState("connectionStatus", status);
}

function setLines(lines: TransitLine[]): void {
  setTransitState("lines", lines);
}

function setStops(stops: Stop[]): void {
  setTransitState(
    produce((state) => {
      for (const stop of stops) {
        state.stops[stop.id] = stop;
      }
    }),
  );
}

function handleSSEEvent(event: SSEEvent): void {
  switch (event.type) {
    case "init":
      setTransitState(
        produce((state) => {
          state.vehicles = {};
          for (const vehicle of event.vehicles) {
            state.vehicles[vehicle.id] = vehicle;
          }
          state.alerts = event.alerts;
          state.lastUpdate = event.timestamp;
        }),
      );
      break;

    case "vehicles":
      setTransitState(
        produce((state) => {
          for (const vehicle of event.updated) {
            state.vehicles[vehicle.id] = vehicle;
          }
          for (const removedId of event.removed) {
            delete state.vehicles[removedId];
          }
          state.lastUpdate = event.timestamp;
        }),
      );
      break;

    case "alerts":
      setTransitState("alerts", event.alerts);
      setTransitState("lastUpdate", event.timestamp);
      break;

    case "heartbeat":
      setTransitState("lastUpdate", event.timestamp);
      break;
  }
}

function getVehiclesByRoute(routeId: string): Vehicle[] {
  return Object.values(transitState.vehicles).filter(
    (v) => v.routeId === routeId,
  );
}

function getVehicleList(): Vehicle[] {
  return Object.values(transitState.vehicles);
}

function getStopList(): Stop[] {
  return Object.values(transitState.stops);
}

export {
  transitState,
  setConnectionStatus,
  setLines,
  setStops,
  handleSSEEvent,
  getVehiclesByRoute,
  getVehicleList,
  getStopList,
};
