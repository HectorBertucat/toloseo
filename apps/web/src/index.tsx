import { render } from "solid-js/web";
import { Router, Route } from "@solidjs/router";
import { AppLayout, MapView, DepartureBoard, AnalyticsView } from "./App";
import "./styles/variables.css";
import "./styles/global.css";

const root = document.getElementById("app");

if (!root) {
  throw new Error("Root element #app not found");
}

render(
  () => (
    <Router root={AppLayout}>
      <Route path="/" component={MapView} />
      <Route path="/board/:stopId?" component={DepartureBoard} />
      <Route path="/analytics" component={AnalyticsView} />
    </Router>
  ),
  root,
);
