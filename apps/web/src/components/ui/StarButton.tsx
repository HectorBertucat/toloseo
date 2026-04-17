import { type Component, Show } from "solid-js";

interface StarButtonProps {
  filled: boolean;
  label: string;
  onToggle: (ev: MouseEvent) => void;
}

const StarButton: Component<StarButtonProps> = (props) => {
  function handle(ev: MouseEvent): void {
    ev.stopPropagation();
    ev.preventDefault();
    // Haptic on supported devices, silent fail elsewhere.
    if ("vibrate" in navigator) navigator.vibrate?.(8);
    props.onToggle(ev);
  }

  return (
    <button
      type="button"
      class="star-btn"
      classList={{ "star-btn--filled": props.filled }}
      onClick={handle}
      aria-label={props.label}
      aria-pressed={props.filled}
      title={props.label}
    >
      <Show
        when={props.filled}
        fallback={
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M12 17.3 5.6 21l1.7-7.3L2 8.8l7.4-.6L12 1.5l2.6 6.7 7.4.6-5.3 4.9L18.4 21Z" />
          </svg>
        }
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M12 17.3 5.6 21l1.7-7.3L2 8.8l7.4-.6L12 1.5l2.6 6.7 7.4.6-5.3 4.9L18.4 21Z" />
        </svg>
      </Show>
    </button>
  );
};

export default StarButton;
