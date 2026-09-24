import type { AudioEngine, EngineEvent } from "./engine";
import { prepareMedia } from "./media-ready";
import { clamp, type GainPoint, mixAt, type PreparedSlot, slotDuration } from "./mix";
import { mixEnd } from "./plan";

const SILENCE =
  "data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YZABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
type AudioNavigator = Navigator & { audioSession?: { type: string } };
interface Graph {
  ctx: AudioContext;
  song: HTMLAudioElement;
  voiceGain: GainNode;
  bedGain: GainNode;
  songGain: GainNode;
  primed: boolean;
}
interface Run {
  slot: PreparedSlot;
  signal: AbortSignal;
  emit: (event: EngineEvent) => void;
  phase: "preparing" | "running" | "paused" | "held";
  positionMs: number;
  fromMs: number;
  contextAt: number;
  songStarted: boolean;
  voiceEligible: boolean;
  voiceReported: boolean;
  voice: AudioBuffer | null;
  bed: AudioBuffer | null;
  sources: AudioBufferSourceNode[];
  timers: Set<ReturnType<typeof setTimeout>>;
  frame: number;
  abort: () => void;
}

/** Native audio is confined here. A run owns every source, timer, callback and seek. */
export class BrowserAudioEngine implements AudioEngine {
  private graph: Graph | null = null;
  private run: Run | null = null;
  private buffers = new Map<string, Promise<AudioBuffer>>();

  constructor(private createAudio: () => HTMLAudioElement = () => new Audio()) {}

  private ensureGraph(): Graph {
    if (this.graph) return this.graph;
    const session = (navigator as AudioNavigator).audioSession;
    if (session) session.type = "playback";
    const ctx = new AudioContext();
    const song = this.createAudio();
    song.preload = "auto";
    const voiceGain = ctx.createGain();
    const bedGain = ctx.createGain();
    const songGain = ctx.createGain();
    for (const node of [voiceGain, bedGain, songGain]) {
      node.gain.value = 0;
      node.connect(ctx.destination);
    }
    ctx.createMediaElementSource(song).connect(songGain);
    this.graph = { ctx, song, voiceGain, bedGain, songGain, primed: false };
    ctx.onstatechange = () => {
      const r = this.run;
      if (!r) return;
      if (ctx.state === "running") this.recover(r);
      else if (r.phase === "running") this.hold(r);
    };
    song.onwaiting = () => {
      const r = this.run;
      if (r?.phase === "running" && r.songStarted && song.readyState < 3 && !song.seeking) this.hold(r);
    };
    song.onpause = () => {
      const r = this.run;
      if (r?.phase === "running" && r.songStarted && song.paused && !song.ended) this.hold(r);
    };
    song.oncanplay = () => {
      if (this.run) this.recover(this.run);
    };
    song.onended = () => {
      const r = this.run;
      // Queued native events have no operation ID. Verify the actual element before accepting one.
      if (
        r?.phase === "running" &&
        r.songStarted &&
        song.ended &&
        !song.seeking &&
        song.getAttribute("src") === r.slot.songUrl
      )
        this.finish(r);
    };
    song.onerror = () => {
      const r = this.run;
      if (r && song.error && song.getAttribute("src") === r.slot.songUrl)
        r.emit({ type: "failed", error: new Error(song.error.message || "Song playback failed") });
    };
    document.addEventListener("visibilitychange", this.visible);
    return this.graph;
  }

  unlock() {
    const g = this.ensureGraph();
    void g.ctx.resume().catch(() => {});
    if (g.primed) return;
    g.primed = true;
    g.song.src = SILENCE;
    void g.song.play().then(
      () => {
        if (g.song.getAttribute("src") === SILENCE) g.song.pause();
      },
      () => {},
    );
  }

  private decode(url: string): Promise<AudioBuffer> {
    const g = this.ensureGraph();
    let buffer = this.buffers.get(url);
    if (!buffer) {
      buffer = fetch(url).then(async (response) => {
        if (!response.ok) throw new Error(`Audio HTTP ${response.status}`);
        return g.ctx.decodeAudioData(await response.arrayBuffer());
      });
      this.buffers.set(url, buffer);
      void buffer.catch(() => {
        if (this.buffers.get(url) === buffer) this.buffers.delete(url);
      });
    }
    return buffer;
  }

  async set(
    slot: PreparedSlot,
    at: number,
    playing: boolean,
    signal: AbortSignal,
    emit: (event: EngineEvent) => void,
  ): Promise<void> {
    this.stop();
    signal.throwIfAborted();
    const g = this.ensureGraph();
    const r: Run = {
      slot,
      signal,
      emit,
      phase: "preparing",
      positionMs: at,
      fromMs: at,
      contextAt: g.ctx.currentTime,
      songStarted: false,
      voiceEligible: !!slot.plan.mic && at <= slot.plan.mic.atMs,
      voiceReported: false,
      voice: null,
      bed: null,
      sources: [],
      timers: new Set(),
      frame: 0,
      abort: () => {
        if (this.run === r) this.stop();
      },
    };
    this.run = r;
    signal.addEventListener("abort", r.abort, { once: true });
    const mix = mixAt(slot, at);
    // Retain the current mix for scrubbing without retaining every decoded DJ take in a long show.
    for (const url of this.buffers.keys())
      if (url !== slot.voiceUrl && url !== slot.bedUrl) this.buffers.delete(url);
    [r.voice, r.bed] = await Promise.all([
      slot.voiceUrl && mix.voice.phase !== "ended" ? this.decode(slot.voiceUrl) : Promise.resolve(null),
      slot.bedUrl && mix.bed.phase !== "ended" ? this.decode(slot.bedUrl) : Promise.resolve(null),
      prepareMedia(g.song, slot.songUrl, mix.song.offsetMs, signal),
    ]);
    if (!this.active(r)) return;
    if (!playing) {
      r.phase = "paused";
      return;
    }
    await g.ctx.resume();
    if (!this.active(r)) return;
    if (mix.song.phase === "active") {
      // The song starts muted. Only confirmed playback establishes the clock and opens the mix.
      await g.song.play();
      if (!this.active(r)) return;
      r.songStarted = true;
      at = slot.plan.music.atMs + g.song.currentTime * 1000;
    }
    this.schedule(r, at);
    this.sample(r);
  }

  private active(r: Run) {
    return this.run === r && !r.signal.aborted;
  }

  readPosition(): number {
    const r = this.run;
    const g = this.graph;
    if (!r || !g) return 0;
    if (r.phase !== "running") return r.positionMs;
    const songClock = r.songStarted && !g.song.ended;
    return clamp(
      songClock
        ? r.slot.plan.music.atMs + g.song.currentTime * 1000
        : r.fromMs + (g.ctx.currentTime - r.contextAt) * 1000,
      slotDuration(r.slot),
    );
  }

  private later(r: Run, delayMs: number, action: () => void) {
    const timer = setTimeout(
      () => {
        r.timers.delete(timer);
        if (this.active(r)) action();
      },
      Math.max(0, delayMs),
    );
    r.timers.add(timer);
  }

  private envelope(node: GainNode, gain: number, points: GainPoint[], at: number, t0: number) {
    node.gain.cancelScheduledValues(t0);
    node.gain.setValueAtTime(gain, t0);
    for (const [ms, value] of points) node.gain.linearRampToValueAtTime(value, t0 + (ms - at) / 1000);
  }

  private schedule(r: Run, at: number) {
    if (!this.active(r)) return;
    const g = this.ensureGraph();
    this.clearSchedule(r);
    r.phase = "running";
    r.positionMs = r.fromMs = at;
    r.contextAt = g.ctx.currentTime;
    const mix = mixAt(r.slot, at);
    const { mic, bed, music } = r.slot.plan;
    this.envelope(g.voiceGain, mix.voice.gain, mix.voice.remaining, at, r.contextAt);
    this.envelope(g.bedGain, mix.bed.gain, mix.bed.remaining, at, r.contextAt);
    this.envelope(g.songGain, mix.song.gain, mix.song.remaining, at, r.contextAt);
    if (mic && r.voice && mix.voice.phase !== "ended") {
      const source = this.source(r, r.voice, g.voiceGain, mic.atMs, mic.endMs, at, false);
      source.onended = () => {
        if (!this.active(r) || r.phase !== "running" || this.readPosition() < mic.endMs - 30) return;
        if (r.voiceEligible && !r.voiceReported) {
          r.voiceReported = true;
          r.emit({ type: "voice-ended" });
        }
        this.finish(r);
      };
    }
    if (bed && r.bed && mix.bed.phase !== "ended")
      this.source(r, r.bed, g.bedGain, bed.atMs, bed.outMs, at, true);
    if (!r.songStarted && mix.song.phase !== "ended") this.queueSong(r, music.atMs - at);
    this.later(r, slotDuration(r.slot) - at + 50, () => this.finish(r));
  }

  private source(
    r: Run,
    buffer: AudioBuffer,
    gain: GainNode,
    begin: number,
    end: number,
    at: number,
    loop: boolean,
  ) {
    const g = this.ensureGraph();
    const source = g.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    source.connect(gain);
    const offset = Math.max(0, at - begin) / 1000;
    source.start(r.contextAt + Math.max(0, begin - at) / 1000, loop ? offset % buffer.duration : offset);
    source.stop(r.contextAt + (end - at) / 1000);
    r.sources.push(source);
    return source;
  }

  private queueSong(r: Run, delayMs: number) {
    this.later(r, delayMs, () => {
      void this.startSong(r).catch((error: unknown) => {
        if (this.active(r))
          r.emit({ type: "failed", error: error instanceof Error ? error : new Error(String(error)) });
      });
    });
  }

  private async startSong(r: Run) {
    if (!this.active(r) || r.phase !== "running") return;
    const g = this.ensureGraph();
    const at = this.readPosition();
    if (at < r.slot.plan.music.atMs) {
      this.queueSong(r, r.slot.plan.music.atMs - at);
      return;
    }
    // Hold the other lanes at the actual head while native playback starts, then re-anchor them.
    this.clearSchedule(r);
    r.phase = "preparing";
    r.positionMs = at;
    await prepareMedia(g.song, r.slot.songUrl, at - r.slot.plan.music.atMs, r.signal);
    if (!this.active(r)) return;
    await g.song.play();
    if (!this.active(r)) return;
    r.songStarted = true;
    this.schedule(r, r.slot.plan.music.atMs + g.song.currentTime * 1000);
    this.sample(r);
  }

  private sample(r: Run) {
    if (!this.active(r) || r.phase !== "running") return;
    r.positionMs = this.readPosition();
    const g = this.graph!;
    const mixedUntil = mixEnd(r.slot.plan);
    const audioPosition = r.fromMs + (g.ctx.currentTime - r.contextAt) * 1000;
    if (r.songStarted && r.positionMs < mixedUntil && Math.abs(audioPosition - r.positionMs) > 500) {
      this.hold(r);
      if (g.song.readyState >= 3) this.recover(r);
      return;
    }
    r.emit({ type: "position", positionMs: r.positionMs });
    if (this.active(r)) r.frame = requestAnimationFrame(() => this.sample(r));
  }

  private finish(r: Run) {
    if (!this.active(r) || r.phase !== "running") return;
    if (r.songStarted && !this.graph?.song.ended) return;
    if (this.readPosition() < slotDuration(r.slot) - 30) return;
    r.positionMs = slotDuration(r.slot);
    r.phase = "paused";
    this.clearSchedule(r);
    r.emit({ type: "ended" });
  }

  private clearSchedule(r: Run) {
    for (const timer of r.timers) clearTimeout(timer);
    r.timers.clear();
    cancelAnimationFrame(r.frame);
    for (const source of r.sources) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    r.sources = [];
    const g = this.graph;
    if (g)
      for (const node of [g.voiceGain, g.bedGain, g.songGain]) {
        node.gain.cancelScheduledValues(g.ctx.currentTime);
        node.gain.setValueAtTime(0, g.ctx.currentTime);
      }
  }

  private hold(r: Run) {
    if (!this.active(r) || r.phase !== "running") return;
    r.positionMs = this.readPosition();
    r.phase = "held";
    this.clearSchedule(r);
    this.graph?.song.pause();
    r.emit({ type: "interrupted", positionMs: r.positionMs });
  }
  private recover(r: Run) {
    if (!this.active(r) || r.phase !== "held" || this.graph?.ctx.state !== "running") return;
    r.phase = "paused";
    r.emit({ type: "recovered" });
  }
  private visible = () => {
    const r = this.run;
    const g = this.graph;
    if (document.visibilityState !== "visible" || !r || !g || (r.phase !== "running" && r.phase !== "held"))
      return;
    void g.ctx.resume().then(
      () => {
        if (this.active(r)) this.recover(r);
      },
      () => {},
    );
    const was = g.ctx.currentTime;
    this.later(r, 300, () => {
      if (r.phase !== "running" || g.ctx.currentTime !== was) return;
      this.hold(r);
      void g.ctx
        .suspend()
        .then(() => {
          if (this.active(r)) return g.ctx.resume();
        })
        .catch(() => {});
    });
  };

  stop(): number {
    const at = this.readPosition();
    const r = this.run;
    this.run = null;
    if (r) {
      r.signal.removeEventListener("abort", r.abort);
      this.clearSchedule(r);
    }
    this.graph?.song.pause();
    return at;
  }
  dispose() {
    this.stop();
    document.removeEventListener("visibilitychange", this.visible);
    const g = this.graph;
    this.graph = null;
    this.buffers.clear();
    if (!g) return;
    g.ctx.onstatechange = null;
    g.song.onwaiting = g.song.onpause = g.song.oncanplay = g.song.onended = g.song.onerror = null;
    g.song.removeAttribute("src");
    g.song.load();
    void g.ctx.close().catch(() => {});
  }
}
