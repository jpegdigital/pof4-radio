import { useEffect, useReducer, useRef } from "react";
import { initialState, reducer, type SegmentView, type StationState } from "./reducer";
import type { SpotifyDevice } from "./use-spotify-device";
import { USER_VOLUME } from "./use-spotify-device";
import { saveStationId, ttsUrl, type VoiceSettings } from "./voice-store";

/**
 * The effects behind the state machine: fetching segments, prefetching talk audio, playing the
 * talk (ducking Spotify), starting tracks, and stopping. Each effect reads the state and does
 * exactly one thing; the reducer decides everything else.
 */

const DUCK_VOLUME = 0.15;
const REQUEST_TIMEOUT_MS = 120_000;

export interface UseStationOptions {
  device: SpotifyDevice;
  stationId: string | null;
  /** Read at request time, so a changed prompt applies to the next block. */
  getPrompt: () => string;
  /** Read at fetch time, so a changed voice applies to the next talk. */
  getVoice: () => VoiceSettings;
  onStation: (id: string) => void;
  onSegment: (segment: SegmentView) => void;
}

export function useStation(opts: UseStationOptions) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const o = useRef(opts);
  const stateRef = useRef<StationState>(state);
  useEffect(() => {
    o.current = opts;
    stateRef.current = state;
  });
  const inFlight = useRef<AbortController | null>(null);
  const fetchingTalk = useRef(new Set<string>());
  const audio = useRef<HTMLAudioElement | null>(null);

  // 1. Ask the DJ for the next segment whenever the state wants one.
  useEffect(() => {
    if (!state.pending || inFlight.current) return;
    const ctrl = new AbortController();
    inFlight.current = ctrl;
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    void (async () => {
      try {
        const res = await fetch("/api/station/next", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stationId: o.current.stationId, prompt: o.current.getPrompt() }),
          signal: ctrl.signal,
        });
        const data = (await res.json()) as { error?: string; stationId?: string; segment?: SegmentView };
        if (res.status === 409) {
          dispatch({ type: "HALT", error: "another tab is running this station" });
          return;
        }
        if (data.stationId && data.stationId !== o.current.stationId) {
          saveStationId(data.stationId);
          o.current.onStation(data.stationId);
        }
        if (!res.ok || !data.segment) {
          dispatch({ type: "SEGMENT_FAILED", error: data.error ?? `request failed (${res.status})` });
          return;
        }
        o.current.onSegment(data.segment);
        dispatch({ type: "SEGMENT_READY", segment: data.segment });
      } catch (err) {
        const message = ctrl.signal.aborted
          ? "the DJ took too long"
          : err instanceof Error
            ? err.message
            : String(err);
        dispatch({ type: "SEGMENT_FAILED", error: message });
      } finally {
        clearTimeout(timer);
        inFlight.current = null;
      }
    })();
  }, [state.pending, state.requestSeq]);

  // 2. Prefetch talk audio for anything loaded that doesn't have it yet.
  const { current, next } = state;
  useEffect(() => {
    for (const l of [current, next]) {
      if (!l || l.talkUrl || l.talkFailed || fetchingTalk.current.has(l.segment.id)) continue;
      const id = l.segment.id;
      fetchingTalk.current.add(id);
      const voice = o.current.getVoice();
      void (async () => {
        try {
          if (!voice.voiceId) throw new Error("no voice chosen (see Voice settings)");
          const res = await fetch(ttsUrl(l.segment.talk, voice));
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? `tts ${res.status}`);
          }
          const url = URL.createObjectURL(await res.blob());
          dispatch({ type: "TALK_READY", segmentId: id, url });
        } catch (err) {
          dispatch({
            type: "TALK_AUDIO_FAILED",
            segmentId: id,
            error: err instanceof Error ? err.message : String(err),
          });
        } finally {
          fetchingTalk.current.delete(id);
        }
      })();
    }
  }, [current, next]);

  // 3. Talk on air: duck Spotify, play the clip, hand over when it ends.
  const talkId = state.phase === "talk" ? state.current?.segment.id : undefined;
  const talkUrl = state.phase === "talk" ? state.current?.talkUrl : undefined;
  const talkFailed = state.phase === "talk" ? state.current?.talkFailed : undefined;
  useEffect(() => {
    if (state.phase !== "talk" || !talkId) return;
    if (talkFailed) {
      dispatch({ type: "SKIP_TALK" });
      return;
    }
    if (!talkUrl) return; // still fetching — the UI shows "loading voice"
    const el = (audio.current ??= new Audio());
    const device = o.current.device;
    void device.pause().catch(() => {});
    void device.setVolume(DUCK_VOLUME).catch(() => {});
    el.src = talkUrl;
    el.onended = () => dispatch({ type: "TALK_ENDED" });
    el.onerror = () =>
      dispatch({ type: "TALK_AUDIO_FAILED", segmentId: talkId, error: "talk audio failed to play" });
    el.play().catch((err: unknown) =>
      dispatch({
        type: "TALK_AUDIO_FAILED",
        segmentId: talkId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return () => {
      el.onended = null;
      el.onerror = null;
      el.pause();
      el.removeAttribute("src");
      el.load();
      URL.revokeObjectURL(talkUrl);
      void device.setVolume(USER_VOLUME).catch(() => {});
    };
  }, [state.phase, talkId, talkUrl, talkFailed]);

  // 4. Tracks on air: (re)start the block at `trackIndex` whenever playSeq bumps.
  const playSeq = state.phase === "tracks" ? state.playSeq : -1;
  useEffect(() => {
    if (playSeq < 0) return;
    const cur = o.current;
    const seg = stateRef.current.current?.segment;
    if (!seg) return;
    cur.device
      .play(
        seg.tracks.map((t) => t.uri),
        stateRef.current.trackIndex,
      )
      .catch((err: unknown) =>
        dispatch({ type: "HALT", error: err instanceof Error ? err.message : String(err) }),
      );
  }, [playSeq]);

  // 5. Stop: silence everything (in-flight requests are allowed to land as `next`).
  useEffect(() => {
    if (state.loop !== "stopped") return;
    audio.current?.pause();
    void o.current.device.pause().catch(() => {});
  }, [state.loop]);

  return { state, dispatch };
}
