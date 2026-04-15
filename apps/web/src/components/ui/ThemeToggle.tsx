import { type Component } from "solid-js";
import { theme, toggleTheme } from "../../stores/ui";

const ThemeToggle: Component = () => {
  return (
    <button
      class="theme-toggle glass"
      onClick={toggleTheme}
      aria-label={
        theme() === "dark"
          ? "Passer au mode clair"
          : "Passer au mode sombre"
      }
      title={
        theme() === "dark"
          ? "Passer au mode clair"
          : "Passer au mode sombre"
      }
    >
      <span aria-hidden="true">{theme() === "dark" ? "\u2600" : "\u263D"}</span>
    </button>
  );
};

export default ThemeToggle;
