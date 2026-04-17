import {
  type Component,
  Show,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import "../../styles/components/install-prompt.css";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "toloseo:install-dismissed";
const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function recentlyDismissed(): boolean {
  if (typeof localStorage === "undefined") return false;
  const raw = localStorage.getItem(DISMISS_KEY);
  if (!raw) return false;
  const ts = Number(raw);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts < DISMISS_COOLDOWN_MS;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) &&
    !("MSStream" in window) &&
    !ua.includes("CriOS")
  );
}

const InstallPrompt: Component = () => {
  const [deferred, setDeferred] = createSignal<BeforeInstallPromptEvent | null>(
    null,
  );
  const [show, setShow] = createSignal(false);
  const [showIos, setShowIos] = createSignal(false);
  let engagementTimer: number | undefined;

  function dismiss(): void {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setShow(false);
    setShowIos(false);
  }

  async function install(): Promise<void> {
    const ev = deferred();
    if (!ev) return;
    await ev.prompt();
    try {
      await ev.userChoice;
    } catch {
      /* ignore */
    }
    setDeferred(null);
    setShow(false);
  }

  function onBeforeInstall(ev: Event): void {
    ev.preventDefault();
    setDeferred(ev as BeforeInstallPromptEvent);
  }

  function onInstalled(): void {
    setDeferred(null);
    setShow(false);
    setShowIos(false);
  }

  onMount(() => {
    if (isStandalone() || recentlyDismissed()) return;
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    // Gate the prompt behind ~30s of engagement so first paint isn't noisy.
    engagementTimer = window.setTimeout(() => {
      if (deferred()) setShow(true);
      else if (isIOS()) setShowIos(true);
    }, 30_000);
  });

  onCleanup(() => {
    window.removeEventListener("beforeinstallprompt", onBeforeInstall);
    window.removeEventListener("appinstalled", onInstalled);
    if (engagementTimer) window.clearTimeout(engagementTimer);
  });

  return (
    <>
      <Show when={show()}>
        <div class="install-prompt" role="dialog" aria-label="Installer Toloseo">
          <div class="install-prompt__body">
            <strong class="install-prompt__title">Installer Toloseo</strong>
            <p class="install-prompt__text">
              Acces rapide, fonctionne meme hors-ligne.
            </p>
          </div>
          <div class="install-prompt__actions">
            <button
              type="button"
              class="install-prompt__btn install-prompt__btn--ghost"
              onClick={dismiss}
            >
              Plus tard
            </button>
            <button
              type="button"
              class="install-prompt__btn install-prompt__btn--primary"
              onClick={install}
            >
              Installer
            </button>
          </div>
        </div>
      </Show>
      <Show when={showIos()}>
        <div class="install-prompt install-prompt--ios" role="dialog">
          <div class="install-prompt__body">
            <strong class="install-prompt__title">Ajouter a l&apos;ecran</strong>
            <p class="install-prompt__text">
              Touchez <span aria-label="Partager">⎙</span> puis{" "}
              <em>Sur l&apos;ecran d&apos;accueil</em>.
            </p>
          </div>
          <button
            type="button"
            class="install-prompt__btn install-prompt__btn--ghost"
            onClick={dismiss}
            aria-label="Fermer"
          >
            OK
          </button>
        </div>
      </Show>
    </>
  );
};

export default InstallPrompt;
