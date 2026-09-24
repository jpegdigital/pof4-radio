import { useEffect, useRef } from "react";
import { lockScreen } from "./transport";
import type { Cue, DeckPhase, TrackClock } from "./types";

/**
 * The lock screen. Under the engine's "playback" audio session iOS treats the page as a media
 * player and routes the lock screen's and the headphones' buttons to it; without handlers it shows
 * a bare player and the buttons do nothing. The metadata is the pick's tags; what state and
 * position it shows is the transport's judgment (lockScreen); play, pause, ⏮ and ⏭ are the
 * transport's moves — read through a ref, so the handlers are set once for the page's life and
 * always reach the current ones.
 */

const ACTIONS: MediaSessionAction[] = ["play", "pause", "previoustrack", "nexttrack"];

export function useMediaSession({
  cue,
  phase,
  track,
  onPlay,
  onPause,
  operationId,
  intent,
  onPrev,
  onNext,
}: {
  cue: Cue | null;
  phase: DeckPhase;
  track: TrackClock | null;
  onPlay: () => void;
  onPause: () => void;
  operationId: number;
  intent: "play" | "pause";
  onPrev: () => void;
  onNext: () => void;
}) {
  const now = useRef({ phase, track, onPlay, onPause, onPrev, onNext });
  useEffect(() => {
    now.current = { phase, track, onPlay, onPause, onPrev, onNext };
  });

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    // Play and pause each do one thing: a stale lock screen must not flip the deck the wrong way.
    ms.setActionHandler("play", () => {
      now.current.onPlay();
    });
    ms.setActionHandler("pause", () => {
      now.current.onPause();
    });
    ms.setActionHandler("previoustrack", () => now.current.onPrev());
    ms.setActionHandler("nexttrack", () => now.current.onNext());
    return () => {
      for (const a of ACTIONS) ms.setActionHandler(a, null);
    };
  }, []);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = cue
      ? new MediaMetadata({
          title: cue.pick.title,
          artist: cue.pick.artists.join(", "),
          album: cue.pick.album,
          artwork: cue.pick.image ? [{ src: cue.pick.image }] : [],
        })
      : null;
  }, [cue]);

  // The state and the scrubber: the record's clock is read every frame, but only a start, a stop
  // seek confirmation or change of phase re-posts it — the device extrapolates between.
  const playing = track?.playing ?? false;
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const { playbackState, position } = lockScreen(phase, now.current.track, intent);
    navigator.mediaSession.playbackState = playbackState;
    if (!position) {
      navigator.mediaSession.setPositionState();
      return;
    }
    navigator.mediaSession.setPositionState({
      duration: position.durationMs / 1000,
      position: position.positionMs / 1000,
      playbackRate: 1,
    });
  }, [cue, phase, playing, operationId, intent]);
}
