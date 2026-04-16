import { type Component } from "solid-js";

const COLLECTION_START = "16 avril 2026";
const RETENTION_LABEL = "1 an";

const DataReliabilityInfo: Component = () => {
  return (
    <div class="data-reliability">
      <h4 class="data-reliability__title">Fiabilite des donnees</h4>
      <ul class="data-reliability__list">
        <li>
          Temps reel uniquement pour <strong>bus et tram</strong> (metro non
          disponible cote feed Tisseo).
        </li>
        <li>
          Horaires theoriques affiches quand aucune donnee live n'est remontee
          pour un trajet.
        </li>
        <li>
          Collecte en continu depuis le {COLLECTION_START}, retention{" "}
          {RETENTION_LABEL}.
        </li>
      </ul>
    </div>
  );
};

export default DataReliabilityInfo;
