import {
  type Component,
  createEffect,
  createSignal,
  onCleanup,
  Show,
} from "solid-js";
import {
  selectedVehicle,
  selectedStop,
  selectedLineIds,
} from "../../stores/ui";
import "../../styles/components/coach-marks.css";

const STORAGE_KEY = "toloseo.hints.seen";
const AUTO_DISMISS_MS = 6000;

type HintId = "vehicle" | "stop" | "line";

interface HintContent {
  title: string;
  body: string;
}

const HINTS: Record<HintId, HintContent> = {
  vehicle: {
    title: "Vehicule selectionne",
    body: "La fleche indique la direction. Appuyez sur « Suivre » pour centrer la carte sur ce vehicule.",
  },
  stop: {
    title: "Arret selectionne",
    body: "Les prochains passages sont affiches par ligne. Un point vert = temps reel, gris = horaire theorique.",
  },
  line: {
    title: "Ligne selectionnee",
    body: "Le trace de la ligne et ses arrets sont mis en avant. Les vehicules des autres lignes sont attenues.",
  },
};

function loadSeen(): Set<HintId> {
  if (typeof localStorage === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as HintId[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function persistSeen(seen: Set<HintId>): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen]));
  } catch {
    // ignore quota / private-mode errors
  }
}

const CoachMarks: Component = () => {
  const [active, setActive] = createSignal<HintId | null>(null);
  const seen = loadSeen();
  let dismissTimer: ReturnType<typeof setTimeout> | null = null;
  let prevVehicle: string | null = selectedVehicle();
  let prevStop: string | null = selectedStop();
  let prevLinesCount = selectedLineIds().length;

  function show(id: HintId): void {
    if (seen.has(id)) return;
    seen.add(id);
    persistSeen(seen);
    setActive(id);
    if (dismissTimer) clearTimeout(dismissTimer);
    dismissTimer = setTimeout(dismiss, AUTO_DISMISS_MS);
  }

  function dismiss(): void {
    setActive(null);
    if (dismissTimer) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }
  }

  createEffect(() => {
    const v = selectedVehicle();
    if (v && v !== prevVehicle) {
      // A brand new selection — fire hint or dismiss the previous one
      if (active() && active() !== "vehicle") dismiss();
      show("vehicle");
    }
    prevVehicle = v;
  });

  createEffect(() => {
    const s = selectedStop();
    if (s && s !== prevStop) {
      if (active() && active() !== "stop") dismiss();
      show("stop");
    }
    prevStop = s;
  });

  createEffect(() => {
    const count = selectedLineIds().length;
    if (count > prevLinesCount) {
      if (active() && active() !== "line") dismiss();
      show("line");
    }
    prevLinesCount = count;
  });

  onCleanup(() => {
    if (dismissTimer) clearTimeout(dismissTimer);
  });

  return (
    <Show when={active()}>
      {(id) => {
        const hint = HINTS[id()];
        return (
          <div class="coach-mark" role="status" aria-live="polite">
            <div class="coach-mark__body">
              <strong class="coach-mark__title">{hint.title}</strong>
              <span class="coach-mark__text">{hint.body}</span>
            </div>
            <button
              type="button"
              class="coach-mark__dismiss"
              onClick={dismiss}
              aria-label="Fermer l'astuce"
            >
              ×
            </button>
          </div>
        );
      }}
    </Show>
  );
};

export default CoachMarks;
