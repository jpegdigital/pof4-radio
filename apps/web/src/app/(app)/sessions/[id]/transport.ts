import type { Plan } from "./plan";
import type { DeckPhase, TrackClock } from "./types";

/**
 * The transport's judgment, pure. The deck runs three lanes from one clock (use-deck.ts); these
 * say, from the plan and the head, what the buttons should do at this moment — and, since the
 * head runs on wall time while the record runs on its element's clock and the graph on the
 * audio clock, when those have come apart and what the deck does about it.
 */

/** ⏮ this far into a slot restarts it instead of going back one (the convention). */
export const RESTART_AFTER_MS = 3000;

/** The head and the record's clock may disagree by this much before the mix is laid again. */
export const DRIFT_MS = 500;

/**
 * Whether a paused deck can pick the slot up where it was: only once the track is on and the
 * voice is done, when the track alone is sounding and the device's own position is the truth
 * (it may have been scrubbed). Earlier — a voice over a bed, a talk-up mid-word — the mix runs
 * again from the head.
 */
export function resumes(plan: Plan, headMs: number): boolean {
  return headMs >= plan.music.atMs && (plan.mic === null || headMs >= plan.mic.endMs);
}

/** Whether the voice is on at this moment. */
export function onMic(plan: Plan, headMs: number): boolean {
  return plan.mic !== null && headMs >= plan.mic.atMs && headMs < plan.mic.endMs;
}

/** Where ⏮ goes from `index`: this slot from the top once well into it, else the one before. */
export function prevTarget(index: number, headMs: number): number {
  if (headMs > RESTART_AFTER_MS) return index;
  return Math.max(0, index - 1);
}

/**
 * The head the record's own clock implies, when it and the head disagree past DRIFT_MS; null
 * when they agree, or the record is not on yet and its clock says nothing. Once the record is
 * on, the element is the truth: an interruption stops it while the head runs on, a stall does
 * the same, a throttled page can leave the head behind.
 */
export function realign(plan: Plan, headMs: number, trackMs: number): number | null {
  if (headMs < plan.music.atMs) return null;
  const implied = plan.music.atMs + trackMs;
  return Math.abs(implied - headMs) >= DRIFT_MS ? implied : null;
}

/** What the deck does when the audio context's state changes. */
export type ContextMove = "hold" | "play";

/**
 * The context's state as the deck reads it. "interrupted" is the platform taking the audio (a
 * call, Siri, another app): on air, that is a hold — the head frozen, to run again from there
 * when the audio comes back. A listener's pause stands through all of it, and a suspend is
 * always the deck's own.
 */
export function onContext(phase: DeckPhase, state: string): ContextMove | null {
  if (phase === "playing" && state === "interrupted") return "hold";
  if (phase === "held" && state === "running") return "play";
  return null;
}

/** What the device's lock screen shows. */
export interface LockScreen {
  playbackState: MediaSessionPlaybackState;
  /** The scrubber: the record's clock, only while the record is on (else it would creep from 0). */
  position: { positionMs: number; durationMs: number } | null;
}

export function lockScreen(phase: DeckPhase, track: TrackClock | null): LockScreen {
  const playbackState: MediaSessionPlaybackState =
    phase === "playing" || phase === "loading"
      ? "playing"
      : phase === "paused" || phase === "held"
        ? "paused"
        : "none";
  const shown =
    playbackState !== "none" &&
    track !== null &&
    track.durationMs > 0 &&
    (track.playing || phase !== "playing");
  return {
    playbackState,
    position: shown
      ? { positionMs: Math.min(track.positionMs, track.durationMs), durationMs: track.durationMs }
      : null,
  };
}
