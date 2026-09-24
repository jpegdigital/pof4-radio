import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Cue } from "./types";

// Exercise the deck's event handlers with synchronous state publication and fake browser audio.
// This does not simulate Safari's audio engine; readiness and clock changes are explicit inputs.
const hooks = vi.hoisted<{
  refs: { current: unknown }[];
  cleanups: (() => void)[];
  state: Record<string, unknown>;
}>(() => ({ refs: [], cleanups: [], state: {} }));
vi.mock("react", () => ({
  useState: (initial: Record<string, unknown>) => {
    hooks.state = initial;
    return [
      initial,
      (next: Record<string, unknown> | ((s: Record<string, unknown>) => Record<string, unknown>)) => {
        hooks.state = typeof next === "function" ? next(hooks.state) : next;
        hooks.refs[0].current = hooks.state;
      },
    ];
  },
  useRef: (current: unknown) => {
    const ref = { current };
    hooks.refs.push(ref);
    return ref;
  },
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void | (() => void)) => {
    const cleanup = effect();
    if (cleanup) hooks.cleanups.push(cleanup);
  },
}));
vi.mock("../../lib/voice-cache", () => ({
  getClip: (url: string) => Promise.resolve({ url: `blob:${url}`, durationMs: 6000 }),
  getBed: () => Promise.resolve({}),
}));

class Media extends EventTarget {
  static all: Media[] = [];
  src = "";
  preload = "";
  readyState = 0;
  currentTime = 0;
  duration = 180;
  seeking = false;
  paused = true;
  error = null;
  onended: (() => void) | null = null;
  play = vi.fn(() => {
    this.paused = false;
    return Promise.resolve();
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  load = vi.fn();
  constructor() {
    super();
    Media.all.push(this);
  }
  getAttribute() {
    return this.src;
  }
  ready() {
    this.readyState = 3;
    this.dispatchEvent(new Event("canplay"));
  }
}

class Context {
  static latest: Context;
  currentTime = 0;
  state = "running";
  destination = {};
  onstatechange: (() => void) | null = null;
  gains: {
    gain: {
      value: number;
      cancelScheduledValues: ReturnType<typeof vi.fn>;
      setValueAtTime: ReturnType<typeof vi.fn>;
      linearRampToValueAtTime: ReturnType<typeof vi.fn>;
    };
  }[] = [];
  constructor() {
    Context.latest = this;
  }
  resume = vi.fn(() => {
    if (this.state !== "running") {
      this.state = "running";
      this.onstatechange?.();
    }
    return Promise.resolve();
  });
  suspend = vi.fn(() => Promise.resolve());
  createGain() {
    const node = {
      gain: {
        value: 0,
        cancelScheduledValues: vi.fn(),
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    };
    this.gains.push(node);
    return node;
  }
  createMediaElementSource() {
    return { connect: vi.fn() };
  }
}

const cue = {
  seq: 0,
  kind: "talkup",
  held: true,
  clipKey: "take",
  voiceInMs: 0,
  pick: { durationMs: 180_000 },
} as Cue;
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
let page: EventTarget & { visibilityState: string };

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  hooks.refs = [];
  hooks.cleanups = [];
  Media.all = [];
  page = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("document", page);
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("Audio", Media);
  vi.stubGlobal("AudioContext", Context);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => {
  for (const cleanup of hooks.cleanups) cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function loadDeck() {
  const { useDeck } = await import("./use-deck");
  // eslint-disable-next-line react-hooks/rules-of-hooks -- React hooks are replaced by the test harness above.
  const deck = useDeck({ sessionId: "session", onSlot: vi.fn() });
  deck.load(cue);
  await flush();
  return deck;
}

describe("deck playback regressions", () => {
  it("starts voice fades only after the actual audio elements are ready on first play", async () => {
    await loadDeck();
    const [mic, rec] = Media.all;
    expect(mic.play).not.toHaveBeenCalled();
    expect(Context.latest.gains[0].gain.linearRampToValueAtTime).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4000);
    Context.latest.currentTime = 4;
    mic.ready();
    await flush();
    expect(mic.play).not.toHaveBeenCalled();
    rec.ready();
    await flush();
    expect(mic.play).toHaveBeenCalledOnce();
    expect(rec.play).toHaveBeenCalledOnce();
    expect(Context.latest.gains[0].gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 10);
  });

  it("does not reload or seek a song when returning to the page after clock drift", async () => {
    await loadDeck();
    for (const media of Media.all) media.ready();
    await flush();
    const rec = Media.all[1];
    vi.advanceTimersByTime(120_000);
    rec.currentTime = 90;
    rec.load.mockClear();
    rec.play.mockClear();
    page.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(rec.currentTime).toBe(90);
    expect(rec.load).not.toHaveBeenCalled();
    expect(rec.play).not.toHaveBeenCalled();
    expect(hooks.state.headMs).toBe(90_000);
  });

  it("can restart an ended track at a position beyond the eight-second mix preview", async () => {
    const deck = await loadDeck();
    for (const media of Media.all) media.ready();
    await flush();
    const rec = Media.all[1];
    rec.currentTime = 180;
    rec.onended?.();
    deck.seekTrack(90_000);
    await flush();
    expect(rec.currentTime).toBe(90);
    expect(hooks.state.headMs).toBe(90_000);
    expect(hooks.state.phase).toBe("playing");
  });

  it("recovers a held context on visibility return without restarting the song", async () => {
    await loadDeck();
    for (const media of Media.all) media.ready();
    await flush();
    vi.advanceTimersByTime(120_000);
    const rec = Media.all[1];
    rec.currentTime = 50;
    Context.latest.state = "interrupted";
    Context.latest.onstatechange?.();
    expect(hooks.state.phase).toBe("held");
    expect(hooks.state.headMs).toBe(50_000);
    page.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(hooks.state.phase).toBe("playing");
    expect(rec.currentTime).toBe(50);
  });

  it("never starts a cue whose preparation was cancelled", async () => {
    const deck = await loadDeck();
    deck.load({ ...cue, seq: 1 });
    await flush();
    for (const media of Media.all) media.ready();
    await flush();
    expect(Media.all[0].play).toHaveBeenCalledOnce();
    expect(hooks.state.cue).toMatchObject({ seq: 1 });
  });
});
