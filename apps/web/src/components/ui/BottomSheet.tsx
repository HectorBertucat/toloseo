import {
  type Component,
  type JSX,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { Portal } from "solid-js/web";
import "../../styles/components/bottom-sheet.css";

type Snap = "mid" | "full";

interface BottomSheetProps {
  /** Whether the sheet is open. Two-way: prefer parent ownership. */
  open: boolean;
  /** Called when the user dismisses (drag-down, backdrop, ESC). */
  onClose: () => void;
  /** Accessible label for the dialog. */
  ariaLabel: string;
  /** Optional title to render in the sheet header. */
  title?: string;
  /** Initial snap when opening. Defaults to mid. */
  initialSnap?: Snap;
  children: JSX.Element;
}

const DRAG_DISMISS_PX = 80;

/**
 * Mobile-first bottom sheet, used in place of a MapLibre Popup on touch
 * devices. Two snap points (mid ≈ 50svh, full ≈ 90svh). Drag the handle
 * down past DRAG_DISMISS_PX to close.
 *
 * - Renders into a Portal so it escapes any clipping ancestor.
 * - Focus is trapped while open and restored to the previously-focused
 *   element on close.
 * - Backdrop is click-to-dismiss.
 * - prefers-reduced-motion: animation duration is 0 (handled in CSS).
 */
const BottomSheet: Component<BottomSheetProps> = (props) => {
  const [snap, setSnap] = createSignal<Snap>(props.initialSnap ?? "mid");
  const [dragOffset, setDragOffset] = createSignal(0);
  let returnFocus: HTMLElement | null = null;
  let sheetRef: HTMLDivElement | undefined;
  let handleRef: HTMLButtonElement | undefined;

  function close(): void {
    props.onClose();
  }

  function trapFocus(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== "Tab" || !sheetRef) return;
    const focusables = sheetRef.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // Pointer drag on the handle. Single-pointer; we don't do physics.
  let dragStartY = 0;
  let dragging = false;
  function onPointerDown(e: PointerEvent): void {
    if (!handleRef) return;
    dragging = true;
    dragStartY = e.clientY;
    handleRef.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent): void {
    if (!dragging) return;
    const dy = e.clientY - dragStartY;
    setDragOffset(Math.max(-200, dy));
  }
  function onPointerUp(): void {
    if (!dragging) return;
    dragging = false;
    const dy = dragOffset();
    setDragOffset(0);
    if (dy > DRAG_DISMISS_PX) {
      // Dragged down past threshold from any state → dismiss.
      close();
      return;
    }
    if (dy < -40 && snap() === "mid") setSnap("full");
    else if (dy > 40 && snap() === "full") setSnap("mid");
  }

  function toggleSnap(): void {
    setSnap((s) => (s === "mid" ? "full" : "mid"));
  }

  onMount(() => {
    document.addEventListener("keydown", trapFocus);
  });

  createEffect(() => {
    if (props.open) {
      returnFocus = document.activeElement as HTMLElement | null;
      // Defer focus so the sheet is in the DOM.
      queueMicrotask(() => {
        const target = sheetRef?.querySelector<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        target?.focus();
      });
      setSnap(props.initialSnap ?? "mid");
    } else if (returnFocus) {
      returnFocus.focus?.();
      returnFocus = null;
    }
  });

  onCleanup(() => {
    document.removeEventListener("keydown", trapFocus);
  });

  return (
    <Portal>
      <Show when={props.open}>
        <div class="bottom-sheet" data-snap={snap()} role="presentation">
          <div
            class="bottom-sheet__backdrop"
            onClick={close}
            aria-hidden="true"
          />
          <div
            ref={sheetRef}
            class="bottom-sheet__panel"
            role="dialog"
            aria-modal="true"
            aria-label={props.ariaLabel}
            style={
              dragOffset() !== 0
                ? `transform: translateY(${dragOffset()}px)`
                : undefined
            }
          >
            <button
              ref={handleRef}
              type="button"
              class="bottom-sheet__handle"
              onClick={toggleSnap}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              aria-label={
                snap() === "mid"
                  ? "Agrandir la fenêtre"
                  : "Réduire la fenêtre"
              }
            >
              <span class="bottom-sheet__handle-bar" />
            </button>
            <Show when={props.title}>
              <header class="bottom-sheet__header">
                <h2 class="bottom-sheet__title">{props.title}</h2>
                <button
                  type="button"
                  class="bottom-sheet__close"
                  onClick={close}
                  aria-label="Fermer"
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    aria-hidden="true"
                  >
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </header>
            </Show>
            <div class="bottom-sheet__body">{props.children}</div>
          </div>
        </div>
      </Show>
    </Portal>
  );
};

export default BottomSheet;
