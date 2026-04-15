import { type Component, createMemo } from "solid-js";
import { transitState } from "../../stores/transit";
import { getVehicleList } from "../../stores/transit";
import { formatDelay } from "../../utils/format";

const NetworkStats: Component = () => {
  const vehicleCount = createMemo(() => getVehicleList().length);

  const alertCount = createMemo(() => transitState.alerts.length);

  const avgDelay = createMemo(() => {
    const vehicles = getVehicleList();
    if (vehicles.length === 0) return 0;
    const total = vehicles.reduce((sum, v) => sum + v.delay, 0);
    return Math.round(total / vehicles.length);
  });

  const statusColor = createMemo(() => {
    const status = transitState.connectionStatus;
    if (status === "connected") return "var(--color-on-time)";
    if (status === "connecting") return "var(--color-minor-delay)";
    return "var(--color-major-delay)";
  });

  return (
    <div class="network-stats glass">
      <div class="network-stats__item">
        <span
          class="network-stats__dot"
          style={{ "background-color": statusColor() }}
        />
        <span class="network-stats__label">
          {transitState.connectionStatus === "connected"
            ? "En direct"
            : transitState.connectionStatus === "connecting"
              ? "Connexion..."
              : "Hors ligne"}
        </span>
      </div>
      <div class="network-stats__item">
        <span class="network-stats__value">{vehicleCount()}</span>
        <span class="network-stats__label">vehicules</span>
      </div>
      <div class="network-stats__item">
        <span class="network-stats__value">{formatDelay(avgDelay())}</span>
        <span class="network-stats__label">retard moy.</span>
      </div>
      <div class="network-stats__item">
        <span class="network-stats__value">{alertCount()}</span>
        <span class="network-stats__label">alertes</span>
      </div>
    </div>
  );
};

export default NetworkStats;
