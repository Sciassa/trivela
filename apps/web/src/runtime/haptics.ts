/**
 * Vibrations of the phones (SPEC §12.9), where the browser supports them (Android; iPhones ignore them). A few
 * moments only, each with its own pattern, so that the hand learns them without looking.
 */

export const HAPTIC = {
  /** I pressed the buzzer. */
  buzz: [50],
  /** The opponent got there first. */
  beaten: [30, 50, 30],
  /** The countdown ran out: ten more seconds to finish typing. */
  grace: [120, 60, 120],
  /** The name I typed is right (felt while the keyboard covers the board). */
  right: [25],
  /** The name I typed is wrong. */
  wrong: [70, 40, 70, 40, 70],
} as const;

export function hapticsOn(): boolean {
  try {
    return localStorage.getItem("trivela.haptics") !== "off";
  } catch {
    return true;
  }
}

export function setHaptics(on: boolean): void {
  try {
    localStorage.setItem("trivela.haptics", on ? "on" : "off");
  } catch {
    /* ignore */
  }
}

export function vibrate(pattern: readonly number[]): void {
  if (!hapticsOn()) return;
  try {
    navigator.vibrate?.([...pattern]);
  } catch {
    /* not supported */
  }
}
