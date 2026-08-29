import { useEffect, useRef } from "react";
import { type LockScreen, lockScreen } from "./media-session";
import type { PlayerFace } from "./player";

/**
 * The lock screen / Control Center / headset buttons, through the Media Session API. iOS pins
 * "Now Playing" to whichever media element played last — the talk's `Audio` or the SDK's own —
 * and the SDK writes its own metadata on every state change, so this is written from the face
 * (which re-renders after each of those) rather than once: every handoff re-asserts the show.
 *
 * Buttons: play/pause is the transport's toggle; ⏮/⏭ are registered only while the cursor can
 * move that way (an unregistered action is simply not shown). No seek — the transport has none.
 */
export function useMediaSession(opts: {
  face: PlayerFace | null;
  running: boolean;
  canPrev: boolean;
  canNext: boolean;
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const o = useRef(opts);
  useEffect(() => {
    o.current = opts;
  });
  const { face, running, canPrev, canNext } = opts;
  const clock = face && face.kind !== "planning" ? face.playback : null;

  // What's on: identity only, plus the SDK's own report time so its metadata write is overruled.
  const identity = face ? JSON.stringify(lockScreen(face)) : "";
  const sdkAt = face?.kind === "track" ? face.playback.at : 0;
  useEffect(() => {
    const ms = navigator.mediaSession;
    if (!ms) return;
    ms.metadata = identity ? new MediaMetadata(JSON.parse(identity) as LockScreen) : null;
  }, [identity, sdkAt]);

  // The buttons.
  useEffect(() => {
    const ms = navigator.mediaSession;
    if (!ms) return;
    const on = (action: MediaSessionAction, handler: (() => void) | null) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {} // an action this browser doesn't know
    };
    on("play", () => o.current.onToggle());
    on("pause", () => o.current.onToggle());
    on("previoustrack", canPrev ? () => o.current.onPrev() : null);
    on("nexttrack", canNext ? () => o.current.onNext() : null);
    return () => {
      for (const a of ["play", "pause", "previoustrack", "nexttrack"] as const) on(a, null);
    };
  }, [canPrev, canNext]);

  // The scrubber and the play/pause glyph, from the clock's last report.
  const paused = !running || (clock?.paused ?? true);
  const duration = clock?.duration ?? 0;
  const reported = clock?.position ?? 0;
  const at = clock?.at ?? 0;
  useEffect(() => {
    const ms = navigator.mediaSession;
    if (!ms) return;
    ms.playbackState = paused ? "paused" : "playing";
    if (duration <= 0) return;
    const position = paused ? reported : reported + (performance.now() - at);
    try {
      ms.setPositionState({
        duration: duration / 1000,
        position: Math.min(Math.max(position, 0), duration) / 1000,
        playbackRate: paused ? 0 : 1,
      });
    } catch {} // position outside duration, or no support
  }, [paused, duration, reported, at]);
}
