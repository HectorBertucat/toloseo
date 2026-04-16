import { type Component, createSignal, Show } from "solid-js";
import DataReliabilityInfo from "./DataReliabilityInfo.jsx";
import "../../styles/components/map-legend.css";

const MapLegend: Component = () => {
  const [open, setOpen] = createSignal(false);

  return (
    <div class="map-legend">
      <button
        class="map-legend__toggle"
        onClick={() => setOpen((v) => !v)}
        aria-label="Afficher la legende"
        title="Legende"
      >
        {open() ? "\u00D7" : "?"}
      </button>
      <Show when={open()}>
        <div class="map-legend__panel" role="dialog">
          <h3 class="map-legend__title">Legende</h3>
          <ul class="map-legend__list">
            <li class="map-legend__item">
              <span class="map-legend__dot map-legend__dot--vehicle" />
              <span>Vehicule en circulation (bus / tram)</span>
            </li>
            <li class="map-legend__item">
              <span class="map-legend__dot map-legend__dot--vehicle-dim" />
              <span>Vehicule hors ligne selectionnee</span>
            </li>
            <li class="map-legend__item">
              <span class="map-legend__dot map-legend__dot--station" />
              <span>Arret / station</span>
            </li>
            <li class="map-legend__item">
              <span class="map-legend__dot map-legend__dot--station-highlight" />
              <span>Arret d'une ligne selectionnee</span>
            </li>
            <li class="map-legend__item">
              <span class="map-legend__dot map-legend__dot--cluster" />
              <span>Groupe d'arrets (dezoomer pour voir)</span>
            </li>
          </ul>
          <p class="map-legend__hint">
            Cliquez sur un vehicule pour voir ses infos et le suivre.
          </p>
          <DataReliabilityInfo />
        </div>
      </Show>
    </div>
  );
};

export default MapLegend;
