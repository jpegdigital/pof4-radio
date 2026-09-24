import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { PlayerSnapshot } from "@/lib/playback/player";
import { clamp } from "@/lib/playback/mix";
import type { Plan } from "@/lib/playback/plan";
import { SessionDeck } from "./session-deck";
import type { Cue, DeckPhase, Slot, TrackClock } from "./types";

export { trackUrlOf } from "./load-slot";

export interface Deck {
  cue: Cue | null;
  phase: DeckPhase;
  ended: boolean;
  message: string | null;
  plan: Plan | null;
  headMs: number;
  track: TrackClock | null;
  operationId: number;
  intent: "play" | "pause";
  playbackId: string;
  unlock: () => void;
  load: (cue: Cue) => void;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  seek: (ms: number) => number | null;
  seekTrack: (ms: number) => number | null;
}

function phaseOf(s: PlayerSnapshot): DeckPhase {
  if (s.phase === "empty") return "idle";
  if (s.phase === "loading") return "loading";
  if (s.phase === "failed") return "error";
  if (s.phase === "ended") return s.intent === "play" ? "waiting" : "paused";
  if (s.phase === "seeking") return "seeking";
  return s.status === "interrupted" ? "held" : s.status;
}

/** Lifecycle and display adapter only. Transport state never depends on a React render. */
export function useDeck({ sessionId, onSlot }: { sessionId: string; onSlot: (slot: Slot) => void }): Deck {
  const deck = useMemo(() => new SessionDeck(sessionId), [sessionId]);
  useEffect(() => {
    deck.setSlotListener(onSlot);
  }, [deck, onSlot]);
  const { cue, playback: snapshot } = useSyncExternalStore(
    deck.subscribe,
    deck.getSnapshot,
    deck.getSnapshot,
  );
  useEffect(() => deck.connect(), [deck]);
  const slot = "slot" in snapshot ? snapshot.slot : null;
  const headMs = snapshot.positionMs;
  return {
    cue,
    phase: phaseOf(snapshot),
    ended: snapshot.phase === "ended",
    message: snapshot.phase === "failed" ? snapshot.error : null,
    plan: slot?.plan ?? null,
    headMs,
    operationId: snapshot.operationId,
    intent: snapshot.intent,
    playbackId: snapshot.id,
    track: slot
      ? {
          positionMs: clamp(headMs - slot.plan.music.atMs, slot.songDurationMs),
          durationMs: slot.songDurationMs,
          playing:
            snapshot.phase === "ready" && snapshot.status === "playing" && headMs >= slot.plan.music.atMs,
        }
      : null,
    unlock: deck.unlock,
    load: deck.load,
    toggle: deck.toggle,
    play: deck.play,
    pause: deck.pause,
    seek: deck.seek,
    seekTrack: deck.seekTrack,
  };
}
