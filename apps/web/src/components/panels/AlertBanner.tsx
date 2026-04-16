import { type Component, For, Show, createSignal, createMemo, onMount } from "solid-js";
import { transitState, setAlerts } from "../../stores/transit";
import { getAlerts } from "../../services/api";
import "../../styles/components/alert-banner.css";

/** Strip HTML tags and decode entities from server-provided alert text. */
function stripHtml(raw: string): string {
  if (!raw) return "";
  // Replace block-level HTML with spaces to keep word boundaries
  const withSpaces = raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|div|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  // Decode common entities
  const decoded = withSpaces
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");

  // Collapse whitespace
  return decoded.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/** Remove emoji prefixes and "🟠 " style header markers from alert titles. */
function cleanHeader(raw: string): string {
  return stripHtml(raw).replace(/^[\s\p{Emoji_Presentation}\p{Extended_Pictographic}]+/u, "").trim();
}

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
                  <h4 class="alert-banner__header">{cleanHeader(alert.headerText)}</h4>
                  <p class="alert-banner__description">
                    {stripHtml(alert.descriptionText)}
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
