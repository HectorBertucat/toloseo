import { type Component, type ParentComponent, lazy } from "solid-js";
import AlertBanner from "./components/panels/AlertBanner";

const MapView = lazy(() => import("./components/map/TransitMap"));
const DepartureBoard = lazy(
  () => import("./components/panels/DepartureBoard"),
);
const AnalyticsView = lazy(
  () => import("./components/analytics/AnalyticsView"),
);

const AppLayout: ParentComponent = (props) => {
  return (
    <div class="app-layout">
      <AlertBanner />
      <main class="app-main">{props.children}</main>
    </div>
  );
};

export { AppLayout, MapView, DepartureBoard, AnalyticsView };
