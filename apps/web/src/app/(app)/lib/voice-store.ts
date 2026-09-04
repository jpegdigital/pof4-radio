/**
 * The DJs as the browser knows them: the roster kept on /settings, read by the page on the
 * server and handed in — names and ids only; the tuning stays on the server, where the audio
 * rung reads it per clip. The browser remembers which one is picked — a per-browser convenience
 * in localStorage, wrapped in try/catch because storage can be missing or blocked.
 */

/** What the page learns about a voice — enough to pick one, none of the tuning. */
export interface Dj {
  id: string;
  name: string;
  gender: "female" | "male";
}

/** An empty roster (no `settings.voices` row yet): the picker shows this and can't open a session. */
export const NO_DJ: Dj = { id: "", name: "No voices on /settings", gender: "male" };

/** The roster's first is the default; a remembered id that's gone from the roster falls back to it. */
export function findDj(djs: readonly Dj[], id: string): Dj {
  return djs.find((d) => d.id === id) ?? djs[0] ?? NO_DJ;
}

const DJ_KEY = "radio.dj";

export function loadDj(djs: readonly Dj[]): Dj {
  try {
    return findDj(djs, localStorage.getItem(DJ_KEY) ?? "");
  } catch {
    return findDj(djs, "");
  }
}

export function saveDj(d: Dj): void {
  try {
    localStorage.setItem(DJ_KEY, d.id);
  } catch {
    // storage unavailable — the choice just won't survive a reload
  }
}
