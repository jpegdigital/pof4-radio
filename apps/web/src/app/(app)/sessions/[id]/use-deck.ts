import { useCallback, useEffect, useRef, useState } from "react";
import { getBed, getClip } from "../../lib/voice-cache";
import {
  BED_GAIN,
  bedGainAt,
  DUCK_MS,
  offsetsAt,
  type Plan,
  planSlot,
  TRACK_DUCK,
  TRACK_FULL,
  trackLevelAt,
  RISE_MS,
} from "./plan";
import { onContext, realign, resumes } from "./transport";
import type { Cue, DeckPhase, Slot, TrackClock } from "./types";

/**
 * The deck: one slot on air at a time, three lanes from one clock. Load a cue and its clip and
 * its track are fetched and measured (the track pulled into the bucket first if the page has not
 * managed it yet — POST on the slot's track, idempotent), the plan laid (plan.ts), then the mic —
 * the voice <audio> element — the bed — a looping buffer — and the track — the MP3 in its own
 * <audio> element — run in one Web Audio graph, the bed's and the track's gain scheduled on the
 * audio clock, the track started at its mark. The run can start anywhere on the timeline (a
 * scrub, a resume): the mic is seeked into its clip, the bed's gain picks up mid-ramp, the track
 * starts that far in. Under the voice the track is ducked — its gain ramped down as the voice
 * comes in over it and back up once it is done (plan.duck). Pause silences all three and freezes
 * the head; play again resumes the track when it alone is sounding, else runs the mix from the
 * head (transport.ts). The head is ms since the slot's top; the track's own clock is its
 * element's, read every frame. Writing and voicing a slot is the page's business (the loop), not
 * the deck's: a cue arrives voiced.
 *
 * Three clocks, tied together once at start: the head and the timers on wall time, the gains and
 * the bed on the audio clock, the record on its element's. The transport's rules (transport.ts)
 * say what to do when they come apart. In the background (Safari hidden, the screen locked) iOS
 * keeps the graph running only under a "playback" audio session, set before the context is made;
 * the page's timers then fire up to a second late, so each lane is seeked to the real head when
 * its start fires (offsetsAt). The platform taking the audio (a call) interrupts the context: the
 * deck holds — the head frozen — and plays again from there when it comes back (onContext). On
 * return to the page the context is resumed by hand, since iOS does not always do it, and the
 * record's own clock is checked against the head (realign). The lock screen is media-session.ts.
 */

const BED_URL = "/bed.mp3";
/** A few ms of silence (WAV); playing it inside a tap unlocks an element for later `play()`s on iOS. */
const SILENCE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
/** How long after coming back to the page before a context clock that has not moved counts as stalled. */
const STALL_CHECK_MS = 300;

export interface Deck {
  cue: Cue | null;
  phase: DeckPhase;
  /** What went wrong, while `phase` is "error". */
  message: string | null;
  plan: Plan | null;
  /** ms since the slot's top; frozen while paused. */
  headMs: number;
  /** Where the track stands, once it is loaded. */
  track: TrackClock | null;
  /** Call synchronously from a tap: the context and the elements must first make sound in a gesture. */
  unlock: () => void;
  /** Put a cue in the deck and run it from the top. */
  load: (cue: Cue) => void;
  /** Pause what is playing; play again what is paused; run the loaded cue when idle. */
  toggle: () => void;
  /** Move the head: the mix runs again from there if playing, or waits there if paused. */
  seek: (ms: number) => void;
  /** Move within the track. */
  seekTrack: (ms: number) => void;
}

interface State {
  cue: Cue | null;
  phase: DeckPhase;
  message: string | null;
  plan: Plan | null;
  clipUrl: string | null;
  trackUrl: string | null;
  headMs: number;
  track: TrackClock | null;
}

/** What is running: timers, the bed source, the frame loop, the clock's origin — all cleared by halt(). */
interface Run {
  timers: number[];
  bed: AudioBufferSourceNode | null;
  frame: number;
  startedAt: number;
}

/** The mix, once per page: the context starts suspended and is resumed inside a tap. */
interface Graph {
  ctx: AudioContext;
  mic: HTMLAudioElement;
  rec: HTMLAudioElement;
  bedGain: GainNode;
  recGain: GainNode;
  primed: boolean;
}
let graph: Graph | null = null;
/** The hook's ear on the context's state; the graph may be made before or after the hook mounts. */
let onState: ((state: string) => void) | null = null;
/** Safari's Audio Session API (not in lib.dom yet): the page says what kind of sound it makes. */
type WithAudioSession = Navigator & { audioSession?: { type: string } };
function ensureGraph(): Graph {
  if (graph) return graph;
  // iOS keeps an AudioContext running when Safari is hidden or the screen locks only while the
  // page's session is "playback" (WebKit's AudioContext::shouldOverrideBackgroundPlaybackRestriction,
  // iOS 17.5+); "auto" is ambient, which the ringer switch silences and the background interrupts.
  const audioSession = (navigator as WithAudioSession).audioSession;
  if (audioSession) audioSession.type = "playback";
  const ctx = new AudioContext();
  ctx.onstatechange = () => {
    console.info("[deck] context:", ctx.state);
    onState?.(ctx.state);
  };
  const mic = new Audio();
  mic.preload = "auto";
  ctx.createMediaElementSource(mic).connect(ctx.destination);
  const bedGain = ctx.createGain();
  bedGain.gain.value = 0;
  bedGain.connect(ctx.destination);
  const rec = new Audio();
  rec.preload = "auto";
  const recGain = ctx.createGain();
  recGain.gain.value = TRACK_FULL;
  ctx.createMediaElementSource(rec).connect(recGain);
  recGain.connect(ctx.destination);
  graph = { ctx, mic, rec, bedGain, recGain, primed: false };
  return graph;
}

/** The clip's URL names its take: the GET is cached forever, and another take is another URL. */
const clipUrlOf = (sessionId: string, seq: number, clipKey: string) =>
  `/api/sessions/${sessionId}/slots/${seq}/clip?take=${encodeURIComponent(clipKey)}`;
/** The track's URL: POST pulls it into the bucket (idempotent), GET streams it, cached forever. */
export const trackUrlOf = (sessionId: string, seq: number) => `/api/sessions/${sessionId}/slots/${seq}/track`;

const IDLE: State = {
  cue: null,
  phase: "idle",
  message: null,
  plan: null,
  clipUrl: null,
  trackUrl: null,
  headMs: 0,
  track: null,
};

const clockOf = (rec: HTMLAudioElement, durationMs: number): TrackClock => ({
  positionMs: rec.currentTime * 1000,
  durationMs: Number.isFinite(rec.duration) && rec.duration > 0 ? rec.duration * 1000 : durationMs,
  playing: !rec.paused,
});

export function useDeck({
  sessionId,
  onSlot,
  onEnded,
}: {
  sessionId: string;
  /** A slot changed (its track came to be held): the page folds it into the document. */
  onSlot: (slot: Slot) => void;
  /** The track played to its end. */
  onEnded: () => void;
}): Deck {
  const [state, setState] = useState<State>(IDLE);
  // The latest state and handlers, for the callbacks (which run from taps and timers, not renders).
  const st = useRef(state);
  const h = useRef({ onSlot, onEnded });
  useEffect(() => {
    st.current = state;
    h.current = { onSlot, onEnded };
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
      g.rec.pause();
      const now = g.ctx.currentTime;
      g.bedGain.gain.cancelScheduledValues(now);
      g.bedGain.gain.setValueAtTime(g.bedGain.gain.value, now);
      g.bedGain.gain.linearRampToValueAtTime(0, now + 0.03);
      g.recGain.gain.cancelScheduledValues(now);
      g.recGain.gain.setValueAtTime(g.recGain.gain.value, now);
      r.bed?.stop(now + 0.05);
    }
    return performance.now() - r.startedAt;
  }, []);

  useEffect(() => () => void halt(), [halt]);

  /** The frame loop: the head and the track's clock follow while the deck runs. */
  const tick = useCallback(function tick() {
    const r = run.current;
    if (!r) return;
    setState((s) => ({
      ...s,
      headMs: performance.now() - r.startedAt,
      track: graph && s.cue ? clockOf(graph.rec, s.cue.pick.durationMs) : s.track,
    }));
    r.frame = requestAnimationFrame(tick);
  }, []);

  /** The three lanes from one clock, from `fromMs` on the timeline. */
  const start = useCallback(
    async (cue: Cue, plan: Plan, clipUrl: string | null, trackUrl: string, fromMs: number) => {
      const g = ensureGraph();
      void g.ctx.resume();
      const from = Math.max(0, Math.min(plan.lengthMs, fromMs));
      const timers: number[] = [];
      const startedAt = performance.now() - from;
      // Something due at `ms` on the timeline: now if it is behind the head, else on time. A hidden
      // page's timers fire up to a second late (iOS aligns them to 1 s while the page plays audio),
      // so an element is seeked to where the head actually stands when its start fires, not to
      // where the plan said it would be: a late start lands in time rather than shifting the track.
      const at = (ms: number, f: (headMs: number) => void) => {
        const d = ms - from;
        if (d <= 0) f(from);
        else timers.push(window.setTimeout(() => f(performance.now() - startedAt), d));
      };
      let bed: AudioBufferSourceNode | null = null;
      if (plan.mic && clipUrl && from < plan.mic.endMs) {
        if (g.mic.src !== clipUrl) {
          g.mic.src = clipUrl;
          g.mic.load();
        }
        at(plan.mic.atMs, (headMs) => {
          const { micMs } = offsetsAt(plan, headMs);
          if (micMs === null) return; // so late the voice is over
          g.mic.currentTime = micMs / 1000;
          g.mic.play().catch((e: unknown) => console.warn("[deck] mic:", e));
        });
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
      // The track's level: where the curve stands now, then each ramp still to come, on the audio clock.
      {
        const t0 = g.ctx.currentTime;
        const { gain } = g.recGain;
        gain.cancelScheduledValues(t0);
        gain.setValueAtTime(trackLevelAt(plan.duck, from), t0);
        if (plan.duck) {
          const d = plan.duck;
          const ramps: [number, number][] = [
            [d.atMs - DUCK_MS, TRACK_FULL],
            [d.atMs, TRACK_DUCK],
            [d.endMs, TRACK_DUCK],
            [d.endMs + RISE_MS, TRACK_FULL],
          ];
          for (const [ms, v] of ramps)
            if (ms > from) gain.linearRampToValueAtTime(v, t0 + (ms - from) / 1000);
        }
      }
      if (g.rec.src !== trackUrl) {
        g.rec.src = trackUrl;
        g.rec.load();
      }
      g.rec.onended = () => h.current.onEnded();
      at(plan.music.atMs, (headMs) => {
        g.rec.currentTime = (offsetsAt(plan, headMs).trackMs ?? 0) / 1000;
        g.rec.play().catch((e: unknown) => {
          setState((s) => ({ ...s, phase: "error", message: e instanceof Error ? e.message : String(e) }));
        });
      });
      run.current = { timers, bed, frame: requestAnimationFrame(tick), startedAt };
      setState({
        cue,
        phase: "playing",
        message: null,
        plan,
        clipUrl,
        trackUrl,
        headMs: from,
        track: clockOf(g.rec, cue.pick.durationMs),
      });
    },
    [tick],
  );

  const unlock = useCallback(() => {
    const g = ensureGraph();
    void g.ctx.resume();
    if (g.primed) return;
    g.primed = true;
    for (const el of [g.mic, g.rec]) {
      el.src = SILENCE;
      void el.play().then(
        () => el.pause(),
        () => {},
      );
    }
  }, []);

  /** The track, held and on the page: POST the pull when the bucket lacks it (a retry of a failed one), then fetch the bytes once. */
  const trackOf = useCallback(
    async (cue: Cue): Promise<{ url: string; durationMs: number }> => {
      const url = trackUrlOf(sessionId, cue.seq);
      if (!cue.held) {
        const res = await fetch(url, { method: "POST" });
        const data = (await res.json().catch(() => null)) as { held?: boolean; error?: string } | null;
        if (!res.ok || !data?.held) throw new Error(data?.error ?? `HTTP ${res.status}`);
        h.current.onSlot({ ...cue, held: true });
      }
      const entry = await getClip(url);
      if ("error" in entry) throw new Error(entry.error);
      return entry;
    },
    [sessionId],
  );

  const load = useCallback(
    (cue: Cue) => {
      halt();
      const seq = ++loads.current;
      setState({ ...IDLE, cue, phase: "loading" });
      (async () => {
        // The clip and the track side by side.
        const voice = (async () => {
          if (!cue.clipKey) return { clipMs: null, clipUrl: null };
          const entry = await getClip(clipUrlOf(sessionId, cue.seq, cue.clipKey));
          if ("error" in entry) throw new Error(entry.error);
          return { clipMs: entry.durationMs, clipUrl: entry.url };
        })();
        const [v, rec] = await Promise.all([voice, trackOf(cue)]);
        const plan = planSlot({
          kind: cue.kind,
          clipMs: v.clipMs,
          recordUnderMs: cue.recordUnderMs,
          voiceInMs: cue.voiceInMs,
          rampMs: cue.chart?.rampMs,
          legalIdChars: cue.legalId?.length ?? 0,
        });
        if (plan.bed) await getBed(ensureGraph().ctx, BED_URL);
        if (seq !== loads.current) return;
        await start({ ...cue, held: true }, plan, v.clipUrl, rec.url, 0);
      })().catch((err: unknown) => {
        if (seq !== loads.current) return;
        setState((x) => ({
          ...x,
          phase: "error",
          message: err instanceof Error ? err.message : String(err),
        }));
      });
    },
    [sessionId, halt, start, trackOf],
  );

  /** Play again from the head, after the listener's pause or the platform's hold. */
  const resume = useCallback(() => {
    const s = st.current;
    if (!s.cue || !s.plan || !s.trackUrl) return;
    if (resumes(s.plan, s.headMs)) {
      // The voice is done: whatever level the pause caught, the track alone is full.
      const g = ensureGraph();
      void g.ctx.resume();
      const now = g.ctx.currentTime;
      g.recGain.gain.cancelScheduledValues(now);
      g.recGain.gain.setValueAtTime(TRACK_FULL, now);
      void g.rec.play().catch((e: unknown) => console.warn("[deck] track:", e));
      run.current = {
        timers: [],
        bed: null,
        frame: requestAnimationFrame(tick),
        startedAt: performance.now() - s.headMs,
      };
      setState((x) => ({ ...x, phase: "playing" }));
    } else void start(s.cue, s.plan, s.clipUrl, s.trackUrl, s.headMs);
  }, [tick, start]);

  const toggle = useCallback(() => {
    const s = st.current;
    if (s.phase === "playing") {
      const headMs = halt();
      setState((x) => ({ ...x, phase: "paused", headMs }));
      return;
    }
    if (!s.cue) return;
    if (s.phase === "paused" || s.phase === "held") resume();
    else if (s.phase === "idle" || s.phase === "error") load(s.cue);
  }, [halt, resume, load]);

  // The platform taking the audio (a call, Siri) interrupts the context: on air, hold — the head
  // frozen — and play again from there when it comes back (transport.ts).
  useEffect(() => {
    onState = (state) => {
      const move = onContext(st.current.phase, state);
      if (move === "hold") {
        const headMs = halt();
        setState((x) => ({ ...x, phase: "held", headMs }));
      } else if (move === "play") resume();
    };
    return () => {
      onState = null;
    };
  }, [halt, resume]);

  // Back from the background while on air. The record's clock is the truth: if it and the head
  // came apart (the record stalled, or ran while the page's timers slept) the mix is laid again
  // from where the record is. Otherwise iOS does not always bring the context back on its own
  // (WebKit bug 263627 — it can even say "running" with its clock stopped): resume it, and if the
  // clock has not moved a moment later, suspend and resume to kick it.
  useEffect(() => {
    const onVisible = () => {
      const g = graph;
      const r = run.current;
      const s = st.current;
      if (document.visibilityState !== "visible" || !g || !r) return;
      if (s.cue && s.plan && s.trackUrl) {
        const headMs = realign(s.plan, performance.now() - r.startedAt, g.rec.currentTime * 1000);
        if (headMs !== null) {
          console.warn(`[deck] the head and the record came apart; the mix again from ${headMs} ms`);
          halt();
          void start(s.cue, s.plan, s.clipUrl, s.trackUrl, headMs);
          return;
        }
      }
      g.ctx.resume().catch((e: unknown) => console.warn("[deck] resume:", e));
      const was = g.ctx.currentTime;
      window.setTimeout(() => {
        if (!run.current || g.ctx.currentTime !== was) return;
        console.warn("[deck] the context's clock stalled after return; kicking it");
        g.ctx
          .suspend()
          .then(() => g.ctx.resume())
          .catch((e: unknown) => console.warn("[deck] kick:", e));
      }, STALL_CHECK_MS);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [halt, start]);

  const seek = useCallback(
    (ms: number) => {
      const s = st.current;
      if (!s.cue || !s.plan || !s.trackUrl) return;
      const headMs = Math.max(0, Math.min(s.plan.lengthMs, ms));
      if (s.phase === "playing") {
        halt();
        void start(s.cue, s.plan, s.clipUrl, s.trackUrl, headMs);
      } else if (s.phase === "paused" || s.phase === "held") setState((x) => ({ ...x, headMs }));
    },
    [halt, start],
  );

  const seekTrack = useCallback((ms: number) => {
    const g = graph;
    const s = st.current;
    if (!g || !s.cue || !s.trackUrl) return;
    g.rec.currentTime = Math.max(0, ms) / 1000;
    setState((x) => ({ ...x, track: x.cue ? clockOf(g.rec, x.cue.pick.durationMs) : x.track }));
  }, []);

  return {
    cue: state.cue,
    phase: state.phase,
    message: state.message,
    plan: state.plan,
    headMs: state.headMs,
    track: state.track,
    unlock,
    load,
    toggle,
    seek,
    seekTrack,
  };
}
