import type { Cue } from "./types";

export function shouldCheckNews(cue: Cue, replay: boolean, fromMs: number, micEndMs: number): boolean {
  const retainedTake = cue.news?.previous?.some((take) => take.clipKey === cue.clipKey);
  return (
    !replay &&
    (Boolean(cue.news?.words) || retainedTake === true || (cue.kind === "break" && !cue.news)) &&
    fromMs < micEndMs
  );
}

/** Prepared alongside news, so offline playback can retain the ID and the music copy. */
export function newsFreeCue(cue: Cue): Cue {
  return {
    ...cue,
    words: cue.news?.musicWords || undefined,
    clipKey: cue.news?.fallbackClipKey,
    news: cue.news
      ? { ...cue.news, words: null, reason: "News omitted: live freshness could not be confirmed" }
      : undefined,
  };
}
