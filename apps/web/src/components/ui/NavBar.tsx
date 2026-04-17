import { type Component, For, createMemo } from "solid-js";
import { A, useLocation } from "@solidjs/router";
import { sheetState } from "../../stores/ui";
import "../../styles/components/nav-bar.css";

interface Destination {
  path: string;
  label: string;
  icon: () => ReturnType<Component>;
  match?: (path: string) => boolean;
}

const NAV: Destination[] = [
  {
    path: "/",
    label: "Carte",
    match: (p) => p === "/",
    icon: () => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" />
        <path d="M9 4v14M15 6v14" />
      </svg>
    ),
  },
  {
    path: "/favoris",
    label: "Favoris",
    icon: () => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 17.3 5.6 21l1.7-7.3L2 8.8l7.4-.6L12 1.5l2.6 6.7 7.4.6-5.3 4.9L18.4 21Z" />
      </svg>
    ),
  },
  {
    path: "/board",
    label: "Arrivees",
    match: (p) => p.startsWith("/board"),
    icon: () => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    ),
  },
  {
    path: "/analytics",
    label: "Stats",
    icon: () => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 20h16" />
        <rect x="6" y="11" width="3" height="7" rx="1" />
        <rect x="11" y="7" width="3" height="11" rx="1" />
        <rect x="16" y="14" width="3" height="4" rx="1" />
      </svg>
    ),
  },
];

const NavBar: Component = () => {
  const location = useLocation();
  const hidden = createMemo(() => {
    // Hide only when the mobile sheet takes over the whole screen.
    return location.pathname === "/" && sheetState() === "full";
  });

  function isActive(dest: Destination): boolean {
    return dest.match
      ? dest.match(location.pathname)
      : location.pathname === dest.path;
  }

  return (
    <nav
      class="nav-bar"
      data-hidden={hidden() ? "1" : undefined}
      aria-label="Navigation principale"
    >
      <ul class="nav-bar__list" role="list">
        <For each={NAV}>
          {(dest) => (
            <li class="nav-bar__item">
              <A
                href={dest.path}
                class="nav-bar__link"
                classList={{ "nav-bar__link--active": isActive(dest) }}
                aria-current={isActive(dest) ? "page" : undefined}
                aria-label={dest.label}
              >
                <span class="nav-bar__icon">{dest.icon()}</span>
                <span class="nav-bar__label">{dest.label}</span>
              </A>
            </li>
          )}
        </For>
      </ul>
    </nav>
  );
};

export default NavBar;
