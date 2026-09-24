import type { Plan } from "@/lib/playback/plan";
import type { DeckPhase, TrackClock } from "./types";

/** Display projections and previous-slot navigation; playback lives in the player controller. */
export const RESTART_AFTER_MS = 3000;

/** Whether the voice is on at this moment. */
export function onMic(plan: Plan, headMs: number): boolean {
  return plan.mic !== null && headMs >= plan.mic.atMs && headMs < plan.mic.endMs;
}

/** Where ⏮ goes from `index`: this slot from the top once well into it, else the one before. */
export function prevTarget(index: number, headMs: number): number {
  if (headMs > RESTART_AFTER_MS) return index;
  return Math.max(0, index - 1);
}

/** What the device's lock screen shows. */
export interface LockScreen {
  playbackState: MediaSessionPlaybackState;
  /** The scrubber: the record's clock, only while the record is on (else it would creep from 0). */
  position: { positionMs: number; durationMs: number } | null;
}

export function lockScreen(
  phase: DeckPhase,
  track: TrackClock | null,
  intent: "play" | "pause" = "play",
): LockScreen {
  const playbackState: MediaSessionPlaybackState =
    phase === "seeking"
      ? intent === "play"
        ? "playing"
        : "paused"
      : phase === "playing" || phase === "loading" || phase === "waiting"
        ? "playing"
        : phase === "paused" || phase === "held"
          ? "paused"
          : "none";
  const shown =
    playbackState !== "none" &&
    phase !== "waiting" &&
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
