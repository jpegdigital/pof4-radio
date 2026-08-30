import type { Element, SegmentView, Skeleton } from "@radio/dj";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { guarded } from "@/lib/guard-client";
import { initialState, type Level, onAir, type ProgramState, reducer } from "./reducer";
import type { SpotifyDevice } from "./use-spotify-device";
import { type ClipEntry, getBed, getClip, prefetch } from "./voice-cache";
import type { Dj } from "./voice-store";

/**
 * The effects behind the station. The reducer says what each lane should be doing; this hook
 * makes it so, and asks the producer for more. Two worlds:
 *
 *   - `music` is the Spotify device. Its audio is DRM'd and can't enter a Web Audio graph, so
 *     the only knob is `setVolume` — stepped from a timer. It plays songs, and nothing else.
 *   - `mic` and `bed` are ours, mixed in one AudioContext. The voice is the <audio> element,
 *     straight in. The bed is one looping buffer that runs the whole time, and the only thing
 *     that ever moves is its gain — scheduled on the audio clock, so it lands exactly and never
 *     clicks. Nothing on this side starts or stops mid-show.
 *
 * Production runs a slot at a time: `open` makes the station and opens its first segment (the
 * records are painted at once); slot 0 — the break — is produced and played; the remaining
 * slots land one by one under the music, each appended as its clip is fetched (voice-cache.ts).
 * As the segment's last song starts, `next` opens the segment after it and its slots follow. A
 * failed request is retried on the next element; a busy station (409) likewise.
 */

export const LEVELS: Record<Exclude<Level, "off">, number> = { full: 0.8, duck: 0.3 };
/** Going up is a stepped ramp (the SDK has no fade); going down is instant — a duck must land at once. */
const RAMP_MS = 500;
const RAMP_STEPS = 25;
/** An outro talk ends this long before the track does. */
export const TAIL_MS = 1000;
/** A waiting talk found this far past its due time still goes; later than that it's skipped. */
const TALK_GRACE_MS = 1000;
/** The bed under the voice: about -18 dB below it (a talk bed is felt, not heard). */
const BED_GAIN = 0.12;
/** A bed comes in over this long and, at the end, fades out over this long into the hand-off. */
const BED_IN_MS = 400;
export const BED_FADE_MS = 1500;
/** `play()` on the device takes about this long to make a sound; a lead is called this much early. */
const PREROLL_MS = 350;
/** A few ms of silence (WAV); playing it inside a tap unlocks the element for later `play()`s on iOS. */
const SILENCE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";

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

export function bedsOf(elements: Element[]): string[] {
  const names = new Set<string>();
  for (const el of elements) if (el.kind === "break" && el.bed) names.add(el.bed);
  return [...names];
}

/** Our half of the mix. Built once; the context starts suspended and is resumed inside a tap. */
interface Graph {
  ctx: AudioContext;
  bedGain: GainNode;
  /** The <audio> element's tap into the graph; an element can be tapped only once. */
  micSource: MediaElementAudioSourceNode | null;
  /** The bed, looping from the moment it's decoded; silent until a break brings its gain up. */
  bedSource: AudioBufferSourceNode | null;
}

function buildGraph(): Graph {
  const ctx = new AudioContext();
  const bedGain = ctx.createGain();
  bedGain.gain.value = 0;
  bedGain.connect(ctx.destination);
  return { ctx, bedGain, micSource: null, bedSource: null };
}

/** The listener's clock, ms since local midnight — the top of the hour is theirs. */
const clockMs = () => {
  const d = new Date();
  return ((d.getHours() * 60 + d.getMinutes()) * 60 + d.getSeconds()) * 1000;
};

export interface UseProgramOptions {
  device: SpotifyDevice;
  /** The DJ on the mic: the voice the show is voiced in and the name in the briefs. */
  dj: Dj;
  /** Read at request time, so a changed request applies to the next segment. */
  getPrompt: () => string;
}

interface StationInfo {
  id: string;
  prompt: string;
  dj: string;
  skeleton: Skeleton | null;
}

const errorOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function useProgram(opts: UseProgramOptions) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const o = useRef(opts);
  const stateRef = useRef<ProgramState>(state);
  useEffect(() => {
    o.current = opts;
    stateRef.current = state;
  });
  const [station, setStation] = useState<StationInfo | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const graph = useRef<Graph | null>(null);
  const beds = useRef(new Set<string>());
  const [clips, setClips] = useState<ReadonlyMap<string, ClipEntry>>(new Map());
  const [micClock, setMicClock] = useState<MicClock | null>(null);

  const ensureGraph = () => (graph.current ??= buildGraph());

  // 1. Every clip of every kept element fetched and measured; the bed decoded, once.
  const { elements } = state;
  useEffect(() => {
    let live = true;
    for (const url of clipsOf(elements)) {
      // Cached or not, the entry lands asynchronously — the cache resolves at once for a clip it has.
      void getClip(url).then((entry) => {
        if (live) setClips((m) => (m.get(url) === entry ? m : new Map(m).set(url, entry)));
      });
    }
    for (const url of bedsOf(elements)) {
      if (beds.current.has(url)) continue;
      const g = ensureGraph();
      void getBed(g.ctx, url)
        .then((buf) => {
          if (!live || g.bedSource) return;
          const src = g.ctx.createBufferSource();
          src.buffer = buf;
          src.loop = true;
          src.connect(g.bedGain);
          src.start();
          g.bedSource = src;
          beds.current.add(url);
        })
        .catch((err: unknown) => console.warn("[station] no bed:", err));
    }
    return () => {
      live = false;
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
  /** Step the device's volume to `target` over `ms` (the SDK has no fade of its own). */
  const rampTo = (target: number, ms: number, steps: number) => {
    stopRamp();
    const d = o.current.device;
    const from = volume.current;
    let step = 0;
    ramp.current = setInterval(() => {
      step += 1;
      volume.current = from + ((target - from) * step) / steps;
      void d.setVolume(volume.current).catch(() => {});
      if (step >= steps) stopRamp();
    }, ms / steps);
  };

  useEffect(() => {
    if (!running || !musicUri || level === "off") return;
    stopRamp();
    const d = o.current.device;
    volume.current = LEVELS[level];
    void d.setVolume(volume.current).catch(() => {});
    d.play([musicUri], 0).catch((err: unknown) => dispatch({ type: "HALT", error: errorOf(err) }));
    // `level` is read for the starting volume only; a change of level is the next effect's business.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.playSeq, running, musicUri]);

  const seqOfLevel = useRef(state.playSeq);
  useEffect(() => {
    const d = o.current.device;
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
    if (target <= volume.current) {
      stopRamp();
      volume.current = target;
      void d.setVolume(target).catch(() => {});
      return;
    }
    rampTo(target, RAMP_MS, RAMP_STEPS);
    return stopRamp;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, state.playSeq]);

  // 3. The bed's gain, scheduled on the audio clock from wherever the voice is in its clip: up
  //    at `bedInMs`, down over BED_FADE_MS landing at the hand-off (the lead, or the clip's end).
  const el = onAir(state);
  const brk = running && el?.kind === "break" && state.mic === el.clip ? el : null;
  const brkRef = useRef(brk);
  useEffect(() => {
    brkRef.current = brk;
  });
  const bedOff = () => {
    const g = graph.current;
    if (!g) return;
    const { gain } = g.bedGain;
    const now = g.ctx.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0, now + 0.03);
  };
  /** Lay the bed's gain for the break on air, given the voice is `posMs` into a clip `durMs` long. */
  const armBed = (posMs: number, durMs: number) => {
    bedOff();
    const b = brkRef.current;
    const g = graph.current;
    if (!b?.bed || !g || !beds.current.has(b.bed)) return;
    const { gain } = g.bedGain;
    const now = g.ctx.currentTime;
    const upAt = now + Math.max(0, (b.bedInMs ?? 0) - posMs) / 1000 + 0.03;
    const downAt = now + Math.max(0, durMs - b.leadMs - BED_FADE_MS - posMs) / 1000;
    const downEnd = now + Math.max(0, durMs - b.leadMs - posMs) / 1000;
    if (downEnd <= upAt) return; // already past the bed
    gain.linearRampToValueAtTime(BED_GAIN, upAt + BED_IN_MS / 1000);
    gain.setValueAtTime(BED_GAIN, Math.max(downAt, upAt + BED_IN_MS / 1000));
    gain.linearRampToValueAtTime(0, downEnd);
  };

  // 4. Mic lane: the voice element, tapped into the graph.
  const mic = state.mic;
  const micEntry = mic ? clips.get(mic) : undefined;
  const micUrl = micEntry && "url" in micEntry ? micEntry.url : undefined;
  const micLen = micEntry && "url" in micEntry ? micEntry.durationMs : 0;
  const micError = micEntry && "error" in micEntry ? micEntry.error : undefined;
  useEffect(() => {
    if (!mic) {
      audio.current?.pause();
      bedOff();
      return;
    }
    if (micError) {
      dispatch({ type: "CLIP_FAILED", clip: mic });
      return;
    }
    if (!micUrl) return; // still loading; the lane shows it
    const a = (audio.current ??= new Audio());
    const g = ensureGraph();
    if (!g.micSource) {
      g.micSource = g.ctx.createMediaElementSource(a);
      g.micSource.connect(g.ctx.destination);
    }
    void g.ctx.resume();
    const report = () =>
      setMicClock({
        paused: a.paused,
        position: a.currentTime * 1000,
        duration: Number.isFinite(a.duration) ? a.duration * 1000 : 0,
        at: performance.now(),
      });
    a.src = micUrl;
    a.onended = () => dispatch({ type: "CLIP_ENDED", clip: mic });
    a.onerror = () => dispatch({ type: "CLIP_FAILED", clip: mic });
    a.onplay = () => {
      armBed(a.currentTime * 1000, micLen);
      report();
    };
    a.onseeked = () => {
      if (!a.paused) armBed(a.currentTime * 1000, micLen);
      report();
    };
    a.onpause = report;
    a.play().catch(() => dispatch({ type: "CLIP_FAILED", clip: mic }));
    const tick = setInterval(() => {
      if (!a.paused) report();
    }, 250);
    return () => {
      clearInterval(tick);
      a.onended = null;
      a.onerror = null;
      a.onplay = null;
      a.onseeked = null;
      a.onpause = null;
      a.pause();
      bedOff();
    };
    // micSeq, not playSeq: a lead restarts the music lane while this clip keeps talking.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mic, micUrl, micError, state.micSeq]);

  // 5. A waiting talk's timer — an outro back-timed off the track's end, a delayed intro timed
  //    off its start — re-armed on every playback report (a seek or a pause moves the due time).
  const waiting =
    running && el?.kind === "song" && el.talk && !state.mic && (el.talk.over === "outro" || el.talk.atMs)
      ? el.talk
      : null;
  const waitingEntry = waiting ? clips.get(waiting.clip) : undefined;
  const waitingLen = waitingEntry && "url" in waitingEntry ? waitingEntry.durationMs : null;
  const pb = opts.device.playback;
  useEffect(() => {
    if (!waiting || waitingLen === null || !pb || pb.uri !== musicUri || pb.paused) return;
    const pos = pb.position + (performance.now() - pb.at);
    const due =
      waiting.over === "outro" ? pb.duration - waitingLen - TAIL_MS - pos : (waiting.atMs ?? 0) - pos;
    // Overdue by more than a beat: the moment has passed (the clip already played, or we joined
    // the song late) — a talk is missed, never repeated.
    if (due < -TALK_GRACE_MS) return;
    const t = setTimeout(() => dispatch({ type: "TALK_DUE" }), Math.max(0, due));
    return () => clearTimeout(t);
  }, [waiting, waitingLen, pb, musicUri]);

  // 6. A break's lead, back-timed off the mic clock (re-armed on every report) and called early
  //    by the device's start latency, so the song sounds where the bed's fade lands.
  const micAt = micClock?.at;
  useEffect(() => {
    if (!brk || !brk.leadMs || !micClock || micClock.paused || micClock.duration <= 0) return;
    const pos = micClock.position + (performance.now() - micClock.at);
    const due = micClock.duration - brk.leadMs - PREROLL_MS - pos;
    const t = setTimeout(() => dispatch({ type: "LEAD_DUE" }), Math.max(0, due));
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brk, micAt]);

  // 7. Stopped → silence; unmount → the graph closes too.
  useEffect(() => {
    if (running) return;
    stopRamp();
    audio.current?.pause();
    bedOff();
    void o.current.device.pause().catch(() => {});
  }, [running]);
  useEffect(
    () => () => {
      audio.current?.pause();
      void graph.current?.ctx.close();
    },
    [],
  );

  // 8. Production, a slot at a time.
  const inFlight = useRef(false);
  /** The cursor at which the last request failed: tried again on the next element, not before. */
  const failedAt = useRef<number | null>(null);

  /** The slots of a segment still to come, in order, each appended as it lands. */
  const produce = useCallback(async (view: SegmentView) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      let current = view;
      for (let seq = current.log.slots.length; seq < current.records.length; seq++) {
        if (stateRef.current.loop !== "running") break;
        dispatch({ type: "PRODUCING" });
        const res = await guarded(`/api/segment/${current.id}/slot/${seq}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clockMs: clockMs() }),
        });
        const data = (await res.json()) as { error?: string; segment?: SegmentView };
        if (res.status === 409) throw new Error(data.error ?? "another tab is producing this station");
        if (!res.ok || !data.segment) throw new Error(data.error ?? `slot ${seq} failed (${res.status})`);
        const fresh = data.segment.elements.slice(current.elements.length);
        await prefetch(clipsOf(fresh));
        current = data.segment;
        failedAt.current = null;
        dispatch({ type: "SEGMENT_SLOT", view: current });
      }
    } catch (err) {
      failedAt.current = stateRef.current.cursor;
      dispatch({ type: "SEGMENT_FAILED", error: errorOf(err) });
    } finally {
      inFlight.current = false;
    }
  }, []);

  /** A request becomes a station and its opening segment; its slots follow. */
  const open = useCallback(
    async (prompt: string) => {
      dispatch({ type: "PRODUCING" });
      try {
        const { dj } = o.current;
        const res = await guarded("/api/station/open", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, dj: dj.name, voiceId: dj.id, clockMs: clockMs() }),
        });
        const data = (await res.json()) as {
          error?: string;
          stationId?: string;
          segment?: SegmentView;
          skeleton?: Skeleton;
        };
        if (!res.ok || !data.stationId || !data.segment)
          throw new Error(data.error ?? `open failed (${res.status})`);
        setStation({ id: data.stationId, prompt, dj: dj.name, skeleton: data.skeleton ?? null });
        dispatch({ type: "SEGMENT_OPENED", view: data.segment });
        await produce(data.segment);
      } catch (err) {
        dispatch({ type: "SEGMENT_FAILED", error: errorOf(err) });
      }
    },
    [produce],
  );

  /** The segment after the last kept one; its slots follow. */
  const next = useCallback(async () => {
    const st = station;
    if (!st || inFlight.current) return;
    inFlight.current = true;
    dispatch({ type: "PRODUCING" });
    try {
      const res = await guarded(`/api/station/${st.id}/next`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: o.current.getPrompt() || st.prompt, clockMs: clockMs() }),
      });
      const data = (await res.json()) as { error?: string; segment?: SegmentView; skeleton?: Skeleton };
      if (res.status === 409) throw new Error(data.error ?? "another tab is producing this station");
      if (!res.ok || !data.segment) throw new Error(data.error ?? `next failed (${res.status})`);
      setStation((s) => (s ? { ...s, skeleton: data.skeleton ?? s.skeleton } : s));
      dispatch({ type: "SEGMENT_OPENED", view: data.segment });
      inFlight.current = false;
      await produce(data.segment);
    } catch (err) {
      failedAt.current = stateRef.current.cursor;
      dispatch({ type: "SEGMENT_FAILED", error: errorOf(err) });
    } finally {
      inFlight.current = false;
    }
  }, [station, produce]);

  /** A kept station: everything loads at once; a segment left unfinished is finished on Run. */
  const resume = useCallback(async (id: string): Promise<StationInfo | null> => {
    const res = await guarded(`/api/station/${id}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      station: { id: string; prompt: string; dj: string };
      skeleton: Skeleton | null;
      segments: SegmentView[];
    };
    const info = {
      id: data.station.id,
      prompt: data.station.prompt,
      dj: data.station.dj,
      skeleton: data.skeleton,
    };
    setStation(info);
    dispatch({ type: "LOAD_SHOW", segments: data.segments });
    void prefetch(data.segments.slice(0, 2).flatMap((s) => clipsOf(s.elements)));
    return info;
  }, []);

  // The last segment's slots still to come are asked for while the show runs (and again on the
  // next element after a failure). Once it is complete and its last element is on air (or the
  // gap past it), the next segment is opened.
  const last = state.segments.at(-1);
  const cursor = state.cursor;
  const wantSlots = running && station !== null && last !== undefined && !last.complete && !state.producing;
  const wantNext =
    running &&
    station !== null &&
    !state.producing &&
    last !== undefined &&
    last.complete &&
    cursor !== null &&
    cursor >= last.to - 1;
  useEffect(() => {
    if (failedAt.current === cursor) return;
    if (wantSlots && last) void produce(last.view);
    else if (wantNext) void next();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantSlots, wantNext, cursor]);

  /** Call synchronously from the tap that starts the show (the context and the element must first start in a gesture). */
  const unlock = useCallback(() => {
    void ensureGraph().ctx.resume();
    const a = (audio.current ??= new Audio());
    if (a.src) return;
    a.src = SILENCE;
    void a.play().then(
      () => a.pause(),
      () => {},
    );
  }, []);

  /** Scrub the clip on the mic (the bed follows, via `onseeked`). */
  const seekMic = useCallback((ms: number) => {
    const a = audio.current;
    if (a?.src) a.currentTime = Math.max(0, ms) / 1000;
  }, []);

  /** Forget the station: a fresh show next time. */
  const clear = useCallback(() => {
    setStation(null);
    dispatch({ type: "CLEAR_SHOW" });
  }, []);

  return {
    state,
    dispatch,
    station,
    clips,
    micClock: mic ? micClock : null,
    unlock,
    seekMic,
    open,
    resume,
    clear,
  };
}
