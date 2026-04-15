import { type Component, lazy } from "solid-js";
import { Route } from "@solidjs/router";
import AlertBanner from "./components/panels/AlertBanner";

const MapView = lazy(() => import("./components/map/TransitMap"));
const DepartureBoard = lazy(
  () => import("./components/panels/DepartureBoard"),
);
const AnalyticsView = lazy(
  () => import("./components/analytics/AnalyticsView"),
);

const App: Component = () => {
  return (
    <div class="app-layout">
      <AlertBanner />
      <main class="app-main">
        <Route path="/" component={MapView} />
        <Route path="/board/:stopId?" component={DepartureBoard} />
        <Route path="/analytics" component={AnalyticsView} />
      </main>
    </div>
  );
};

export default App;
