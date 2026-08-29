import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { guarded } from "@/lib/guard-client";
import { atTail, cursorSegment, initialState, reducer, type SegmentView, type StationState } from "./reducer";
import type { SpotifyDevice } from "./use-spotify-device";
import { USER_VOLUME } from "./use-spotify-device";
import { type Dj, ttsUrl } from "./voice-store";

/**
 * The effects behind the state machine. Each effect reads the state and does exactly one thing;
 * the reducer decides everything else.
 *
 * Talk audio is its own pipeline, separate from segment text: the hook keeps a per-session cache
 * (`voiceId:segmentId` → blob url) and makes sure the segment under the cursor and the one after
 * it are voiced. Fetched by *position*, never by arrival — so a resumed show's past blocks are
 * voiced the moment they're tapped, and a rewind in a live show is instant. Nothing is revoked
 * while its segment is in the list.
 */

const DUCK_VOLUME = 0.15;
/** A few ms of silence (WAV); playing it inside a tap unlocks the element for later `play()`s on iOS. */
const SILENCE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
const REQUEST_TIMEOUT_MS = 120_000;
/** Prev on a track this far in restarts it instead (the Spotify convention). */
const RESTART_AFTER_MS = 3000;

export type TalkEntry = { url: string } | { error: string };

export interface TalkPlayback {
  paused: boolean;
  /** ms as of `at` (performance.now()). */
  position: number;
  duration: number;
  at: number;
}

export interface UseStationOptions {
  device: SpotifyDevice;
  stationId: string | null;
  /** The DJ on the mic: the voice for talk audio and the name sent with each planning request. */
  dj: Dj;
  /** Read at request time, so a changed prompt applies to the next block. */
  getPrompt: () => string;
  onStation: (id: string) => void;
}

const talkKey = (voiceId: string, segmentId: string) => `${voiceId}:${segmentId}`;

export function useStation(opts: UseStationOptions) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const o = useRef(opts);
  const stateRef = useRef<StationState>(state);
  useEffect(() => {
    o.current = opts;
    stateRef.current = state;
  });
  const inFlight = useRef<AbortController | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const [talks, setTalks] = useState<ReadonlyMap<string, TalkEntry>>(new Map());
  const fetchingTalk = useRef(new Set<string>());
  // The audio element's last report, tagged with the talk it was for; derived to null off-talk.
  const [talkClock, setTalkClock] = useState<(TalkPlayback & { id: string }) | null>(null);

  const voiceId = opts.dj.id;
  const running = state.loop === "running";
  const cur = cursorSegment(state);
  const nextSeg = state.cursor ? (state.segments[state.cursor.seg + 1] ?? null) : null;
  const onTalk = running && state.phase === "playing" && state.cursor?.item === 0 ? cur : null;

  // 1. Ask the DJ for the next segment whenever the state wants one.
  useEffect(() => {
    if (!state.pending || inFlight.current) return;
    const ctrl = new AbortController();
    inFlight.current = ctrl;
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    void (async () => {
      try {
        const res = await guarded("/api/station/next", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stationId: o.current.stationId,
            prompt: o.current.getPrompt(),
            dj: o.current.dj.name,
          }),
          signal: ctrl.signal,
        });
        const data = (await res.json()) as { error?: string; stationId?: string; segment?: SegmentView };
        if (res.status === 409) {
          dispatch({ type: "HALT", error: "another tab is running this station" });
          return;
        }
        if (data.stationId && data.stationId !== o.current.stationId) o.current.onStation(data.stationId);
        if (!res.ok || !data.segment) {
          dispatch({ type: "SEGMENT_FAILED", error: data.error ?? `request failed (${res.status})` });
          return;
        }
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

  // 2. Voice: the segment under the cursor and the one after it, in the current DJ's voice.
  const curId = cur?.id;
  const nextId = nextSeg?.id;
  useEffect(() => {
    if (!running) return;
    for (const seg of [cur, nextSeg]) {
      if (!seg) continue;
      const key = talkKey(voiceId, seg.id);
      const have = talks.get(key);
      if ((have && "url" in have) || fetchingTalk.current.has(key)) continue; // a failed fetch is retried
      fetchingTalk.current.add(key);
      const voice = o.current.dj.voice;
      void (async () => {
        let entry: TalkEntry;
        try {
          const res = await guarded(ttsUrl(seg.talk, voice));
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? `tts ${res.status}`);
          }
          entry = { url: URL.createObjectURL(await res.blob()) };
        } catch (err) {
          entry = { error: err instanceof Error ? err.message : String(err) };
        } finally {
          fetchingTalk.current.delete(key);
        }
        // Adding is also when blobs of segments no longer in the list are dropped (the 20-cap, Start fresh).
        const ids = new Set(stateRef.current.segments.map((x) => x.id));
        setTalks((m) => {
          const kept = new Map<string, TalkEntry>();
          for (const [k, v] of m) {
            if (ids.has(k.slice(k.indexOf(":") + 1))) kept.set(k, v);
            else if ("url" in v) URL.revokeObjectURL(v.url);
          }
          return kept.set(key, entry);
        });
      })();
    }
    // `talks` is read, not depended on: a landed blob must not re-run the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, curId, nextId, voiceId]);

  // 3. Talk on air: duck Spotify, play the clip, hand over when it ends.
  const onTalkId = onTalk?.id;
  const onTalkEntry = onTalkId ? talks.get(talkKey(voiceId, onTalkId)) : undefined;
  const onTalkUrl = onTalkEntry && "url" in onTalkEntry ? onTalkEntry.url : undefined;
  const onTalkError = onTalkEntry && "error" in onTalkEntry ? onTalkEntry.error : undefined;
  useEffect(() => {
    if (!onTalkId) return;
    if (onTalkError) {
      dispatch({ type: "TALK_FAILED", segmentId: onTalkId });
      return;
    }
    if (!onTalkUrl) {
      return; // still fetching — the player shows "loading voice…"
    }
    const el = (audio.current ??= new Audio());
    const device = o.current.device;
    void device.pause().catch(() => {});
    void device.setVolume(DUCK_VOLUME).catch(() => {});
    const report = () =>
      setTalkClock({
        id: onTalkId,
        paused: el.paused,
        position: el.currentTime * 1000,
        duration: Number.isFinite(el.duration) ? el.duration * 1000 : 0,
        at: performance.now(),
      });
    el.src = onTalkUrl;
    el.onended = () => dispatch({ type: "ENDED" });
    el.onerror = () => dispatch({ type: "TALK_FAILED", segmentId: onTalkId });
    el.onplay = report;
    el.onpause = report;
    el.ondurationchange = report;
    el.play().catch(() => dispatch({ type: "TALK_FAILED", segmentId: onTalkId }));
    const tick = setInterval(() => {
      if (!el.paused) report();
    }, 500);
    return () => {
      clearInterval(tick);
      el.onended = null;
      el.onerror = null;
      el.onplay = null;
      el.onpause = null;
      el.ondurationchange = null;
      el.pause();
      el.removeAttribute("src");
      el.load();
      void device.setVolume(USER_VOLUME).catch(() => {});
    };
  }, [onTalkId, onTalkUrl, onTalkError, state.playSeq]);

  // 4. Tracks on air: (re)start the block at the cursor's track whenever playSeq bumps.
  const onTrack = running && state.phase === "playing" && (state.cursor?.item ?? 0) > 0;
  const playSeq = onTrack ? state.playSeq : -1;
  useEffect(() => {
    if (playSeq < 0) return;
    const s = stateRef.current;
    const seg = cursorSegment(s);
    if (!seg || !s.cursor) return;
    o.current.device
      .play(
        seg.tracks.map((t) => t.uri),
        s.cursor.item - 1,
      )
      .catch((err: unknown) =>
        dispatch({ type: "HALT", error: err instanceof Error ? err.message : String(err) }),
      );
  }, [playSeq]);

  // 5. Stop: silence everything (in-flight requests are allowed to land in the list).
  useEffect(() => {
    if (running) return;
    audio.current?.pause();
    void o.current.device.pause().catch(() => {});
  }, [running]);

  // The transport. Talk and track are the same three buttons; only what they touch differs.
  const toggle = useCallback(() => {
    const s = stateRef.current;
    if (s.loop !== "running" || !s.cursor) return;
    if (s.cursor.item === 0) {
      const el = audio.current;
      if (!el?.src) return;
      if (el.paused) void el.play().catch(() => {});
      else el.pause();
      return;
    }
    const d = o.current.device;
    void (d.playback?.paused ? d.resume() : d.pause()).catch(() => {});
  }, []);

  const prev = useCallback(() => {
    const s = stateRef.current;
    if (!s.cursor || s.cursor.item === 0) {
      dispatch({ type: "PREV" });
      return;
    }
    const p = o.current.device.playback;
    const pos = p ? (p.paused ? p.position : p.position + (performance.now() - p.at)) : 0;
    if (pos > RESTART_AFTER_MS) dispatch({ type: "JUMP", ...s.cursor });
    else dispatch({ type: "PREV" });
  }, []);

  const next = useCallback(() => dispatch({ type: "NEXT" }), []);

  /**
   * Call synchronously from the tap that starts the show. iOS Safari only lets an
   * `HTMLMediaElement` play if *that element* first played inside a user gesture; the talk plays
   * from an effect later, so the element is created and unlocked here, then reused.
   */
  const unlock = useCallback(() => {
    const el = (audio.current ??= new Audio());
    if (el.src) return; // already unlocked (or mid-talk)
    el.src = SILENCE;
    void el.play().then(
      () => el.pause(),
      () => {},
    );
  }, []);

  const talk = useCallback((segmentId: string) => talks.get(talkKey(voiceId, segmentId)), [talks, voiceId]);

  const talkPlayback: TalkPlayback | null =
    onTalkUrl && talkClock && talkClock.id === onTalkId ? talkClock : null;

  return { state, dispatch, talk, talkPlayback, toggle, prev, next, unlock, atTail: atTail(state) };
}
