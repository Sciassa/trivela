/**
 * Installable app helpers (SPEC §12.7): the install prompt of Android browsers, and full screen for those who play
 * from the browser without installing.
 */

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();

export function watchInstall(): void {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // keep it for our own button
    deferred = e as InstallPrompt;
    listeners.forEach((f) => f());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    listeners.forEach((f) => f());
  });
}

export const canInstall = (): boolean => deferred !== null;

export function onInstallChange(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

export async function install(): Promise<boolean> {
  if (!deferred) return false;
  const d = deferred;
  deferred = null;
  await d.prompt();
  const r = await d.userChoice;
  listeners.forEach((f) => f());
  return r.outcome === "accepted";
}

/** Opened from the home screen icon (installed app). */
export function isInstalled(): boolean {
  return (
    matchMedia("(display-mode: fullscreen)").matches ||
    matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export const isIOS = (): boolean => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/**
 * In the browser of a phone (not installed), the first tap asks for full screen: the address bar and the browser's
 * gestures go away. Not on computers, and never again if the player leaves full screen.
 */
export function enterFullscreenOnPhone(): void {
  try {
    const coarse = matchMedia("(pointer: coarse)").matches;
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    if (!coarse || isInstalled() || document.fullscreenElement || !el.requestFullscreen) return;
    void el.requestFullscreen({ navigationUI: "hide" }).catch(() => undefined);
  } catch {
    /* not supported (iPhone Safari): installing is the way */
  }
}
