import { type Component, type ParentComponent, lazy } from "solid-js";
import AlertBanner from "./components/panels/AlertBanner";
import NavBar from "./components/ui/NavBar";
import InstallPrompt from "./components/ui/InstallPrompt";

const MapView = lazy(() => import("./components/map/TransitMap"));
const DepartureBoard = lazy(
  () => import("./components/panels/DepartureBoard"),
);
const AnalyticsView = lazy(
  () => import("./components/analytics/AnalyticsView"),
);
const FavoritesView = lazy(
  () => import("./components/panels/FavoritesView"),
);

const AppLayout: ParentComponent = (props) => {
  return (
    <div class="app-layout">
      <AlertBanner />
      <main class="app-main">{props.children}</main>
      <NavBar />
      <InstallPrompt />
    </div>
  );
};

export { AppLayout, MapView, DepartureBoard, AnalyticsView, FavoritesView };
