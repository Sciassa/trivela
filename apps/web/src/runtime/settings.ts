/**
 * Settings of this device, chosen on the home screen and remembered (SPEC §3.8). Per-viewer conveniences: the app
 * works the same if the storage is not available.
 */

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/** Countdowns on (default) or off. */
export const timerOn = (): boolean => read("trivela.timer") !== "off";
export const setTimerOn = (on: boolean): void => write("trivela.timer", on ? "on" : "off");

/** Years offered by the "from year" filter on the home screen: the data start with the 2012/13 season. */
export const YEAR_CHOICES = [null, 2014, 2016, 2018, 2020, 2022, 2024] as const;

/** "Only questions from this year on"; null: every season. */
export function savedYear(): number | null {
  const y = Number(read("trivela.year"));
  return Number.isInteger(y) && y >= 1900 && y <= 2100 ? y : null;
}
export const saveYear = (y: number | null): void => write("trivela.year", y === null ? "" : String(y));
