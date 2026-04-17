import { render } from "solid-js/web";
import { Router, Route } from "@solidjs/router";
import {
  AppLayout,
  MapView,
  DepartureBoard,
  AnalyticsView,
  FavoritesView,
} from "./App";
import { importFromQuery } from "./stores/favorites";
import "./styles/variables.css";
import "./styles/global.css";
import "./styles/animations.css";
import "./styles/components/nav-bar.css";
import "./styles/components/favorites-view.css";
import "./styles/components/install-prompt.css";

const root = document.getElementById("app");

if (!root) {
  throw new Error("Root element #app not found");
}

// Import favorites from ?fav= before first render so they show up immediately.
importFromQuery();

render(
  () => (
    <Router root={AppLayout}>
      <Route path="/" component={MapView} />
      <Route path="/board/:stopId?" component={DepartureBoard} />
      <Route path="/favoris" component={FavoritesView} />
      <Route path="/analytics" component={AnalyticsView} />
    </Router>
  ),
  root,
);
