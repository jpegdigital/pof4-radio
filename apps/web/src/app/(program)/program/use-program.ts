import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { SpotifyDevice } from "@/components/station/use-spotify-device";
import { clipUrl } from "./manifest";
import { type Element, initialState, type Level, onAir, reducer } from "./reducer";

/**
 * The effects behind the program. The reducer says what each lane should be doing; this hook
 * makes it so: the Spotify device for `music` (play, pause, level), one <audio> for `mic`.
 * Every clip is fetched and measured at mount — the whole program is known up front.
 */

export const LEVELS: Record<Exclude<Level, "off">, number> = { full: 0.8, duck: 0.3, bed: 0.25 };
/** Going up is a stepped ramp (the SDK has no fade); going down is instant — a duck must land at once. */
const RAMP_MS = 500;
const RAMP_STEPS = 10;
/** An outro talk ends this long before the track does. */
export const TAIL_MS = 1000;
/** A few ms of silence (WAV); playing it inside a tap unlocks the element for later `play()`s on iOS. */
const SILENCE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";

export type ClipEntry = { url: string; durationMs: number } | { error: string };

export interface MicClock {
  paused: boolean;
  /** ms as of `at` (performance.now()). */
  position: number;
  duration: number;
  at: number;
}

export function clipsOf(elements: Element[]): string[] {
  const names = new Set<string>();
  for (const el of elements) {
    if (el.kind === "song") {
      if (el.talk) names.add(el.talk.clip);
    } else names.add(el.clip);
  }
  return [...names];
}

export function useProgram({ device, elements }: { device: SpotifyDevice; elements: Element[] }) {
  const [state, dispatch] = useReducer(reducer, { ...initialState, elements });
  const dev = useRef(device);
  useEffect(() => {
    dev.current = device;
  });
  const audio = useRef<HTMLAudioElement | null>(null);
  const [clips, setClips] = useState<ReadonlyMap<string, ClipEntry>>(new Map());
  const [micClock, setMicClock] = useState<MicClock | null>(null);

  // 1. Every clip, fetched and measured once.
  useEffect(() => {
    const urls: string[] = [];
    let live = true;
    for (const name of clipsOf(elements)) {
      void (async () => {
        let entry: ClipEntry;
        try {
          const res = await fetch(clipUrl(name));
          if (!res.ok) throw new Error(`clip ${name}: ${res.status}`);
          const url = URL.createObjectURL(await res.blob());
          urls.push(url);
          entry = { url, durationMs: await measure(url) };
        } catch (err) {
          entry = { error: err instanceof Error ? err.message : String(err) };
        }
        if (live) setClips((m) => new Map(m).set(name, entry));
      })();
    }
    return () => {
      live = false;
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, [elements]);

  // 2. Music lane. A new element (playSeq) starts its track at its level, no ramp; a level
  //    change within an element ducks at once or ramps back up.
  const { uri: musicUri, level } = state.music;
  const running = state.loop === "running";
  const ramp = useRef<ReturnType<typeof setInterval> | null>(null);
  const volume = useRef(LEVELS.full);
  const stopRamp = () => {
    if (ramp.current) clearInterval(ramp.current);
    ramp.current = null;
  };
  useEffect(() => {
    if (!running || !musicUri || level === "off") return;
    stopRamp();
    const d = dev.current;
    volume.current = LEVELS[level];
    void d.setVolume(volume.current).catch(() => {});
    d.play([musicUri], 0).catch((err: unknown) =>
      dispatch({ type: "HALT", error: err instanceof Error ? err.message : String(err) }),
    );
    // `level` is read for the starting volume only; a change of level is effect 2b's business.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.playSeq, running, musicUri]);

  const seqOfLevel = useRef(state.playSeq);
  useEffect(() => {
    const d = dev.current;
    if (level === "off") {
      stopRamp();
      void d.pause().catch(() => {});
      return;
    }
    if (seqOfLevel.current !== state.playSeq) {
      seqOfLevel.current = state.playSeq; // set by the play effect above
      return;
    }
    const target = LEVELS[level];
    const from = volume.current;
    stopRamp();
    if (target <= from) {
      volume.current = target;
      void d.setVolume(target).catch(() => {});
      return;
    }
    let step = 0;
    ramp.current = setInterval(() => {
      step += 1;
      volume.current = from + ((target - from) * step) / RAMP_STEPS;
      void d.setVolume(volume.current).catch(() => {});
      if (step >= RAMP_STEPS) stopRamp();
    }, RAMP_MS / RAMP_STEPS);
    return stopRamp;
  }, [level, state.playSeq]);

  // 3. Mic lane.
  const mic = state.mic;
  const micEntry = mic ? clips.get(mic) : undefined;
  const micUrl = micEntry && "url" in micEntry ? micEntry.url : undefined;
  const micError = micEntry && "error" in micEntry ? micEntry.error : undefined;
  useEffect(() => {
    if (!mic) {
      audio.current?.pause();
      return;
    }
    if (micError) {
      dispatch({ type: "CLIP_FAILED", clip: mic });
      return;
    }
    if (!micUrl) return; // still loading; the lane shows it
    const el = (audio.current ??= new Audio());
    const report = () =>
      setMicClock({
        paused: el.paused,
        position: el.currentTime * 1000,
        duration: Number.isFinite(el.duration) ? el.duration * 1000 : 0,
        at: performance.now(),
      });
    el.src = micUrl;
    el.onended = () => dispatch({ type: "CLIP_ENDED", clip: mic });
    el.onerror = () => dispatch({ type: "CLIP_FAILED", clip: mic });
    el.onplay = report;
    el.onpause = report;
    el.play().catch(() => dispatch({ type: "CLIP_FAILED", clip: mic }));
    const tick = setInterval(() => {
      if (!el.paused) report();
    }, 250);
    return () => {
      clearInterval(tick);
      el.onended = null;
      el.onerror = null;
      el.onplay = null;
      el.onpause = null;
      el.pause();
    };
  }, [mic, micUrl, micError, state.playSeq]);

  // 4. Outro back-timer, re-armed on every playback report (a seek or a pause moves the due time).
  const el = onAir(state);
  const outro =
    running && el?.kind === "song" && el.talk?.over === "outro" && !state.mic ? el.talk.clip : null;
  const outroEntry = outro ? clips.get(outro) : undefined;
  const outroLen = outroEntry && "url" in outroEntry ? outroEntry.durationMs : null;
  const pb = device.playback;
  useEffect(() => {
    if (!outro || outroLen === null || !pb || pb.uri !== musicUri || pb.paused) return;
    const pos = pb.position + (performance.now() - pb.at);
    const due = pb.duration - outroLen - TAIL_MS - pos;
    const t = setTimeout(() => dispatch({ type: "OUTRO_DUE" }), Math.max(0, due));
    return () => clearTimeout(t);
  }, [outro, outroLen, pb, musicUri]);

  // 5. Stopped → silence; unmount → the element goes quiet too.
  useEffect(() => {
    if (running) return;
    stopRamp();
    audio.current?.pause();
    void dev.current.pause().catch(() => {});
  }, [running]);
  useEffect(() => () => audio.current?.pause(), []);

  /** Call synchronously from the tap that starts the program (iOS: the element must first play in a gesture). */
  const unlock = useCallback(() => {
    const a = (audio.current ??= new Audio());
    if (a.src) return;
    a.src = SILENCE;
    void a.play().then(
      () => a.pause(),
      () => {},
    );
  }, []);

  // The element's last report is only meaningful while a clip is on the mic.
  /** Scrub the clip on the mic. */
  const seekMic = useCallback((ms: number) => {
    const a = audio.current;
    if (a?.src) a.currentTime = Math.max(0, ms) / 1000;
  }, []);

  return { state, dispatch, clips, micClock: mic ? micClock : null, unlock, seekMic };
}

/** Chrome reports a streamed mp3's length through `durationchange` (finite), not `loadedmetadata`. */
function measure(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const a = document.createElement("audio");
    a.preload = "auto";
    a.ondurationchange = () => {
      if (Number.isFinite(a.duration)) resolve(a.duration * 1000);
    };
    a.onerror = () => reject(new Error("could not read the clip's length"));
    a.src = url;
  });
}
