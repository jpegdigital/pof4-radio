import { useCallback, useEffect, useRef, useState } from "react";
import type { SpotifyDevice } from "../../lib/use-spotify-device";
import { getBed, getClip } from "../../lib/voice-cache";
import {
  BED_GAIN,
  bedGainAt,
  DUCK_MS,
  type Plan,
  planSlot,
  RECORD_FULL,
  recordLevelAt,
  RISE_MS,
} from "./plan";
import { resumes } from "./transport";
import type { Cue, Slot } from "./types";

/**
 * The deck: one slot on air at a time, three lanes from one clock. Load a cue and its clip is
 * made if it isn't yet (POST audio, idempotent), fetched and measured, the plan laid (plan.ts),
 * then the mic — the voice <audio> element — and the bed — a looping buffer — run in one Web
 * Audio graph with the bed's gain scheduled on the audio clock, and the record — the Spotify
 * device — starts at its mark. The run can start anywhere on the timeline (a scrub, a resume):
 * the mic is seeked into its clip, the bed's gain picks up mid-ramp, the record starts that far
 * in. Under the voice the record is ducked — the device's volume stepped down as the voice
 * comes in and back up once it is done (plan.duck). Pause silences all three and freezes the
 * head; play again resumes the record when it
 * alone is sounding, else runs the mix from the head (transport.ts). The head is ms since the
 * slot's top; the record's own clock is the device's (playback).
 */

const BED_URL = "/bed.mp3";
/** The record's volume is stepped this often through a ramp. */
const LEVEL_STEP_MS = 50;
/** A few ms of silence (WAV); playing it inside a tap unlocks the element for later `play()`s on iOS. */
const SILENCE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";

export type DeckPhase = "idle" | "voicing" | "loading" | "playing" | "paused" | "error";

export interface Deck {
  cue: Cue | null;
  phase: DeckPhase;
  /** What went wrong, while `phase` is "error". */
  message: string | null;
  plan: Plan | null;
  /** ms since the slot's top; frozen while paused. */
  headMs: number;
  /** Call synchronously from a tap: the context and the voice element must first make sound in a gesture. */
  unlock: () => void;
  /** Put a cue in the deck and run it from the top. */
  load: (cue: Cue) => void;
  /** Pause what is playing; play again what is paused; run the loaded cue when idle. */
  toggle: () => void;
  /** Move the head: the mix runs again from there if playing, or waits there if paused. */
  seek: (ms: number) => void;
}

interface State {
  cue: Cue | null;
  phase: DeckPhase;
  message: string | null;
  plan: Plan | null;
  clipUrl: string | null;
  headMs: number;
}

/** What is running: timers, the bed source, the frame loop, the clock's origin — all cleared by halt(). */
interface Run {
  timers: number[];
  bed: AudioBufferSourceNode | null;
  frame: number;
  startedAt: number;
}

/** Our half of the mix, once per page: the context starts suspended and is resumed inside a tap. */
interface Graph {
  ctx: AudioContext;
  mic: HTMLAudioElement;
  bedGain: GainNode;
  primed: boolean;
}
let graph: Graph | null = null;
function ensureGraph(): Graph {
  if (graph) return graph;
  const ctx = new AudioContext();
  const mic = new Audio();
  mic.preload = "auto";
  ctx.createMediaElementSource(mic).connect(ctx.destination);
  const bedGain = ctx.createGain();
  bedGain.gain.value = 0;
  bedGain.connect(ctx.destination);
  graph = { ctx, mic, bedGain, primed: false };
  return graph;
}

const audioUrl = (sessionId: string, num: number, seq: number) =>
  `/api/sessions/${sessionId}/segments/${num}/slots/${seq}/audio`;
/** The clip's URL names its take: the GET is cached forever, and another take is another URL. */
const clipUrlOf = (sessionId: string, num: number, seq: number, clipKey: string) =>
  `${audioUrl(sessionId, num, seq)}?take=${encodeURIComponent(clipKey)}`;

const IDLE: State = { cue: null, phase: "idle", message: null, plan: null, clipUrl: null, headMs: 0 };

export function useDeck({
  sessionId,
  device,
  onSlot,
}: {
  sessionId: string;
  device: SpotifyDevice;
  /** A slot came back voiced from the audio rung: the page folds it into the document. */
  onSlot: (num: number, slot: Slot) => void;
}): Deck {
  const [state, setState] = useState<State>(IDLE);
  // The latest state and device, for the handlers (which run from taps and timers, not renders).
  const st = useRef(state);
  const dev = useRef(device);
  useEffect(() => {
    st.current = state;
    dev.current = device;
  });
  const run = useRef<Run | null>(null);
  // A load overtaken by a later one must not start playing.
  const loads = useRef(0);

  /** Silence all three lanes and stop the clock. Returns the head where it stopped. */
  const halt = useCallback((): number => {
    const r = run.current;
    run.current = null;
    if (!r) return st.current.headMs;
    for (const t of r.timers) clearTimeout(t);
    cancelAnimationFrame(r.frame);
    const g = graph;
    if (g) {
      g.mic.pause();
      const now = g.ctx.currentTime;
      g.bedGain.gain.cancelScheduledValues(now);
      g.bedGain.gain.setValueAtTime(g.bedGain.gain.value, now);
      g.bedGain.gain.linearRampToValueAtTime(0, now + 0.03);
      r.bed?.stop(now + 0.05);
    }
    void dev.current.pause().catch(() => {});
    return performance.now() - r.startedAt;
  }, []);

  useEffect(() => () => void halt(), [halt]);

  /** The frame loop: the head follows the clock while the deck runs. */
  const tick = useCallback(function tick() {
    const r = run.current;
    if (!r) return;
    setState((s) => ({ ...s, headMs: performance.now() - r.startedAt }));
    r.frame = requestAnimationFrame(tick);
  }, []);

  /** The three lanes from one clock, from `fromMs` on the timeline. */
  const start = useCallback(
    async (cue: Cue, plan: Plan, clipUrl: string | null, fromMs: number) => {
      const g = ensureGraph();
      void g.ctx.resume();
      const from = Math.max(0, Math.min(plan.lengthMs, fromMs));
      const timers: number[] = [];
      const startedAt = performance.now() - from;
      // Something due at `ms` on the timeline: now if it is behind the head, else on time.
      const at = (ms: number, f: () => void) => {
        const d = ms - from;
        if (d <= 0) f();
        else timers.push(window.setTimeout(f, d));
      };
      let bed: AudioBufferSourceNode | null = null;
      if (plan.mic && clipUrl && from < plan.mic.endMs) {
        if (g.mic.src !== clipUrl) {
          g.mic.src = clipUrl;
          g.mic.load();
        }
        g.mic.currentTime = Math.max(0, from - plan.mic.atMs) / 1000;
        at(plan.mic.atMs, () => void g.mic.play().catch((e: unknown) => console.warn("[deck] mic:", e)));
      }
      if (plan.bed && from < plan.bed.outMs) {
        const buf = await getBed(g.ctx, BED_URL);
        bed = g.ctx.createBufferSource();
        bed.buffer = buf;
        bed.loop = true;
        bed.connect(g.bedGain);
        const b = plan.bed;
        const t0 = g.ctx.currentTime;
        const { gain } = g.bedGain;
        gain.cancelScheduledValues(t0);
        gain.setValueAtTime(bedGainAt(b, from), t0);
        const ramps: [number, number][] = [
          [b.atMs, 0],
          [b.fullMs, BED_GAIN],
          [b.downMs, BED_GAIN],
          [b.outMs, 0],
        ];
        for (const [ms, v] of ramps) if (ms > from) gain.linearRampToValueAtTime(v, t0 + (ms - from) / 1000);
        bed.start(t0 + Math.max(0, b.atMs - from) / 1000);
        bed.stop(t0 + (b.outMs - from) / 1000 + 0.1);
      }
      // The record's level: where the curve stands now, then stepped through each ramp still to
      // come (the device has no fade of its own, only setVolume). halt() clears the steps.
      const setLevel = (v: number) => void dev.current.setVolume(v).catch(() => {});
      setLevel(recordLevelAt(plan.duck, from));
      if (plan.duck) {
        const d = plan.duck;
        for (const [startMs, lengthMs] of [
          [d.atMs - DUCK_MS, DUCK_MS],
          [d.endMs, RISE_MS],
        ]) {
          for (let t = startMs + LEVEL_STEP_MS; t <= startMs + lengthMs; t += LEVEL_STEP_MS)
            if (t > from) at(t, () => setLevel(recordLevelAt(d, t)));
        }
      }
      at(plan.music.atMs, () => {
        dev.current.play([cue.track.uri], 0, from - plan.music.atMs).catch((e: unknown) => {
          setState((s) => ({ ...s, phase: "error", message: e instanceof Error ? e.message : String(e) }));
        });
      });
      run.current = { timers, bed, frame: requestAnimationFrame(tick), startedAt };
      setState({ cue, phase: "playing", message: null, plan, clipUrl, headMs: from });
    },
    [tick],
  );

  const unlock = useCallback(() => {
    const g = ensureGraph();
    void g.ctx.resume();
    if (g.primed) return;
    g.primed = true;
    g.mic.src = SILENCE;
    void g.mic.play().then(
      () => g.mic.pause(),
      () => {},
    );
  }, []);

  const load = useCallback(
    (cue: Cue) => {
      halt();
      const seq = ++loads.current;
      setState({ ...IDLE, cue, phase: cue.slot.voiced ? "loading" : "voicing" });
      (async () => {
        let s = cue.slot;
        if (!s.voiced) {
          const res = await fetch(audioUrl(sessionId, cue.num, s.seq), { method: "POST" });
          const data = (await res.json().catch(() => null)) as Slot | { error?: string } | null;
          if (!res.ok || !data || !("seq" in data))
            throw new Error(data && "error" in data && data.error ? data.error : `HTTP ${res.status}`);
          s = data;
          onSlot(cue.num, s);
          if (seq !== loads.current) return;
          setState((x) => ({ ...x, phase: "loading" }));
        }
        let clipMs: number | null = null;
        let clipUrl: string | null = null;
        if (s.clipKey) {
          const entry = await getClip(clipUrlOf(sessionId, cue.num, s.seq, s.clipKey));
          if ("error" in entry) throw new Error(entry.error);
          clipMs = entry.durationMs;
          clipUrl = entry.url;
        }
        const plan = planSlot({
          kind: s.kind,
          clipMs,
          recordUnderMs: s.recordUnderMs,
          voiceInMs: s.voiceInMs,
          introMs: s.introMs,
          legalIdChars: s.legalId?.length ?? 0,
        });
        if (plan.bed) await getBed(ensureGraph().ctx, BED_URL);
        if (seq !== loads.current) return;
        await start({ ...cue, slot: s }, plan, clipUrl, 0);
      })().catch((err: unknown) => {
        if (seq !== loads.current) return;
        setState((x) => ({
          ...x,
          phase: "error",
          message: err instanceof Error ? err.message : String(err),
        }));
      });
    },
    [sessionId, onSlot, halt, start],
  );

  const toggle = useCallback(() => {
    const s = st.current;
    if (s.phase === "playing") {
      const headMs = halt();
      setState((x) => ({ ...x, phase: "paused", headMs }));
      return;
    }
    if (!s.cue) return;
    if (s.phase === "paused" && s.plan) {
      if (resumes(s.plan, s.headMs)) {
        // The voice is done: whatever level the pause caught, the record alone is full.
        void dev.current.setVolume(RECORD_FULL).catch(() => {});
        void dev.current.resume().catch(() => {});
        run.current = {
          timers: [],
          bed: null,
          frame: requestAnimationFrame(tick),
          startedAt: performance.now() - s.headMs,
        };
        setState((x) => ({ ...x, phase: "playing" }));
      } else void start(s.cue, s.plan, s.clipUrl, s.headMs);
      return;
    }
    if (s.phase === "idle" || s.phase === "error") load(s.cue);
  }, [halt, tick, start, load]);

  const seek = useCallback(
    (ms: number) => {
      const s = st.current;
      if (!s.cue || !s.plan) return;
      const headMs = Math.max(0, Math.min(s.plan.lengthMs, ms));
      if (s.phase === "playing") {
        halt();
        void start(s.cue, s.plan, s.clipUrl, headMs);
      } else if (s.phase === "paused") setState((x) => ({ ...x, headMs }));
    },
    [halt, start],
  );

  return {
    cue: state.cue,
    phase: state.phase,
    message: state.message,
    plan: state.plan,
    headMs: state.headMs,
    unlock,
    load,
    toggle,
    seek,
  };
}
