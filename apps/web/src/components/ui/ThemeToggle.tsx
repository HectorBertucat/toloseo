import { type Component, Show } from "solid-js";
import { theme, toggleTheme } from "../../stores/ui";

const ThemeToggle: Component = () => {
  const label = (): string =>
    theme() === "dark" ? "Passer au mode clair" : "Passer au mode sombre";
  return (
    <button
      type="button"
      class="theme-toggle glass"
      onClick={toggleTheme}
      aria-label={label()}
      title={label()}
    >
      <Show
        when={theme() === "dark"}
        fallback={
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
          </svg>
        }
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      </Show>
    </button>
  );
};

export default ThemeToggle;
