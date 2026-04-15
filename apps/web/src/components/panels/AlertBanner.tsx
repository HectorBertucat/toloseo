import { type Component, For, Show, createSignal, createMemo, onMount } from "solid-js";
import { transitState, setAlerts } from "../../stores/transit";
import { getAlerts } from "../../services/api";
import "../../styles/components/alert-banner.css";

type Severity = "info" | "warning" | "error";

function alertSeverity(effect: string): Severity {
  switch (effect) {
    case "NO_SERVICE":
    case "SIGNIFICANT_DELAYS":
      return "error";
    case "DETOUR":
    case "REDUCED_SERVICE":
      return "warning";
    default:
      return "info";
  }
}

function highestSeverity(effects: string[]): Severity {
  if (effects.some((e) => alertSeverity(e) === "error")) return "error";
  if (effects.some((e) => alertSeverity(e) === "warning")) return "warning";
  return "info";
}

const AlertBanner: Component = () => {
  const [expanded, setExpanded] = createSignal(false);

  onMount(async () => {
    if (transitState.alerts.length === 0) {
      try {
        const alerts = await getAlerts();
        setAlerts(alerts);
      } catch { /* SSE will populate later */ }
    }
  });

  const alertCount = createMemo(() => transitState.alerts.length);

  const severity = createMemo(() =>
    highestSeverity(transitState.alerts.map((a) => a.effect)),
  );

  return (
    <Show when={alertCount() > 0}>
      <div class="alert-banner" data-severity={severity()}>
        <button
          class="alert-banner__summary"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded()}
        >
          <span class="alert-banner__icon" aria-hidden="true">
            {severity() === "error"
              ? "\u26A0"
              : severity() === "warning"
                ? "\u26A0"
                : "\u2139"}
          </span>
          <span class="alert-banner__count">
            {alertCount()} alerte{alertCount() > 1 ? "s" : ""} active
            {alertCount() > 1 ? "s" : ""}
          </span>
          <span class="alert-banner__chevron" aria-hidden="true">
            {expanded() ? "\u25B2" : "\u25BC"}
          </span>
        </button>

        <Show when={expanded()}>
          <div class="alert-banner__details">
            <For each={transitState.alerts}>
              {(alert) => (
                <div
                  class="alert-banner__alert"
                  data-severity={alertSeverity(alert.effect)}
                >
                  <h4 class="alert-banner__header">{alert.headerText}</h4>
                  <p class="alert-banner__description">
                    {alert.descriptionText}
                  </p>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
};

export default AlertBanner;
