import { tone as toneUrl } from "./testing/audio-fixture";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { BrowserAudioEngine } from "./browser-engine";
import { Player } from "./player";
import { planSlot } from "./plan";
import type { PreparedSlot } from "./mix";
import type { EngineEvent } from "./engine";
import { SongSources } from "./song-source";

const urls: string[] = [];
const engines: BrowserAudioEngine[] = [];
function tone(seconds: number) {
  const url = toneUrl(seconds);
  urls.push(url);
  return url;
}
async function setup(delayedSong = false) {
  let song!: HTMLAudioElement;
  const engine = new BrowserAudioEngine(() => {
    const media = new Audio();
    song ??= media;
    return media;
  });
  engines.push(engine);
  const unlock = document.createElement("button");
  unlock.textContent = "Unlock audio";
  unlock.onclick = () => engine.unlock();
  document.body.append(unlock);
  try {
    await userEvent.click(unlock);
  } finally {
    unlock.remove();
  }
  const slot: PreparedSlot = {
    id: "test/take",
    songUrl: tone(6),
    voiceUrl: tone(2),
    bedUrl: tone(1),
    songDurationMs: 6000,
    plan: planSlot({ kind: "break", clipMs: 2000, recordUnderMs: delayedSong ? 500 : 2000, legalIdChars: 0 }),
  };
  return { engine, slot, song: () => song };
}
afterEach(() => {
  for (const engine of engines.splice(0)) engine.dispose();
  for (const url of urls.splice(0)) URL.revokeObjectURL(url);
  vi.restoreAllMocks();
});

describe("native browser audio contract", () => {
  it("adopts the buffered next element and renews its URL on a paused seek after expiry", async () => {
    const media: HTMLAudioElement[] = [];
    const sources = new SongSources();
    const engine = new BrowserAudioEngine(() => {
      const audio = new Audio();
      media.push(audio);
      return audio;
    }, sources.resolve.bind(sources));
    engines.push(engine);
    const first = tone(6);
    const refreshed = tone(6);
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const nativeFetch = globalThis.fetch.bind(globalThis);
    const signing = vi
      .fn<() => Promise<Response>>()
      .mockImplementationOnce(() =>
        Promise.resolve(Response.json({ url: first, expiresAt: now + 3_600_000 })),
      )
      .mockImplementationOnce(() =>
        Promise.resolve(Response.json({ url: refreshed, expiresAt: now + 3_600_000 })),
      );
    vi.spyOn(globalThis, "fetch").mockImplementation((url, init) =>
      url === "/signed-track" ? signing() : nativeFetch(url, init),
    );
    engine.preload("/signed-track", 6000);
    await expect.poll(() => media[1]?.readyState).toBeGreaterThanOrEqual(3);
    const reload = vi.spyOn(media[1], "load");
    const slot: PreparedSlot = {
      id: "signed",
      songUrl: "/signed-track",
      songDurationMs: 6000,
      voiceUrl: null,
      bedUrl: null,
      plan: planSlot({ kind: "segue", clipMs: null, legalIdChars: 0 }),
    };
    await engine.set(slot, 1500, false, new AbortController().signal, () => {});
    expect(reload).not.toHaveBeenCalled();
    expect(media[1].currentTime).toBeCloseTo(1.5, 2);
    expect(media[1].crossOrigin).toBe("anonymous");
    expect(signing).toHaveBeenCalledOnce();
    now += 3_600_001;
    await engine.set(slot, 2500, false, new AbortController().signal, () => {});
    expect(media[1].src).toBe(refreshed);
    expect(media[1].currentTime).toBeCloseTo(2.5, 2);
    expect(signing).toHaveBeenCalledTimes(2);
    engine.preload("/signed-track", 6000);
    expect(media).toHaveLength(2);
  });

  it("waits for first-play voice decoding before scheduling the mix", async () => {
    const { engine, slot } = await setup();
    const nativeFetch = globalThis.fetch.bind(globalThis);
    const response = await nativeFetch(slot.voiceUrl!);
    let ready!: (response: Response) => void;
    const delayed = new Promise<Response>((resolve) => {
      ready = resolve;
    });
    const fetchAudio = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => (input === slot.voiceUrl ? delayed : nativeFetch(input, init)));
    const starts = vi.spyOn(AudioBufferSourceNode.prototype, "start");
    const pending = engine.set(slot, 0, true, new AbortController().signal, () => {});
    await expect.poll(() => fetchAudio.mock.calls.length).toBeGreaterThan(0);
    expect(starts).not.toHaveBeenCalled();
    ready(response);
    await pending;
    expect(starts).toHaveBeenCalledOnce();
    const source = starts.mock.contexts[0] as AudioBufferSourceNode;
    expect(starts.mock.calls[0][0]).toBeGreaterThan(source.context.currentTime - 0.15);
    expect(starts.mock.calls[0][1]).toBeLessThan(0.15);
  });

  it("seeks the looping bed to its corresponding phase instead of restarting it", async () => {
    const { engine, slot } = await setup(true);
    const starts = vi.spyOn(AudioBufferSourceNode.prototype, "start");
    await engine.set(slot, 1200, true, new AbortController().signal, () => {});
    const bedIndex = starts.mock.contexts.findIndex((source) => (source as AudioBufferSourceNode).loop);
    expect(bedIndex).toBeGreaterThanOrEqual(0);
    expect(starts.mock.calls[bedIndex][1]).toBeCloseTo(0.2, 2);
  });

  it("reports the complete voice and the natural song end once each", async () => {
    const { engine, slot } = await setup();
    const short: PreparedSlot = {
      ...slot,
      songUrl: tone(0.6),
      voiceUrl: tone(0.2),
      songDurationMs: 600,
      bedUrl: null,
      plan: planSlot({ kind: "talkup", clipMs: 200, recordUnderMs: 200, legalIdChars: 0 }),
    };
    const events = vi.fn((_event: EngineEvent) => {});
    await engine.set(short, 0, true, new AbortController().signal, events);
    await expect
      .poll(() => events.mock.calls.filter(([event]) => event.type === "ended").length, { timeout: 3000 })
      .toBe(1);
    expect(events.mock.calls.filter(([event]) => event.type === "voice-ended")).toHaveLength(1);
    expect(engine.readPosition()).toBe(600);
  });
  it("recovers a genuinely suspended context at the same song position", async () => {
    const { engine, slot, song } = await setup();
    const resume = vi.spyOn(AudioContext.prototype, "resume");
    const player = new Player(engine);
    player.load(slot.id, () => Promise.resolve(slot));
    await expect.poll(() => player.getSnapshot().phase).toBe("ready");
    player.seek({ coordinate: "song", ms: 1000 });
    await expect.poll(() => player.getSnapshot().phase).toBe("ready");
    const context = resume.mock.contexts.at(-1) as AudioContext;
    await context.suspend();
    await expect.poll(() => player.getSnapshot()).toMatchObject({ phase: "ready", status: "interrupted" });
    const at = song().currentTime;
    document.dispatchEvent(new Event("visibilitychange"));
    await expect.poll(() => player.getSnapshot()).toMatchObject({ phase: "ready", status: "playing" });
    expect(song().currentTime).toBeGreaterThanOrEqual(at);
    expect(song().currentTime).toBeLessThan(at + 0.4);
    player.dispose();
  });
  it("places a paused seek before play and schedules the DJ at the same destination", async () => {
    const { engine, slot, song } = await setup();
    const starts = vi.spyOn(AudioBufferSourceNode.prototype, "start");
    const paused = new AbortController();
    await engine.set(slot, 1000, false, paused.signal, () => {});
    expect(song().currentTime).toBeCloseTo(1, 2);
    expect(song().paused).toBe(true);
    expect(starts).not.toHaveBeenCalled();
    paused.abort();
    await engine.set(slot, 1000, true, new AbortController().signal, () => {});
    expect(song().paused).toBe(false);
    expect(starts.mock.calls.some((call) => Math.abs((call[1] ?? 0) - 1) < 0.15)).toBe(true);
    expect(engine.readPosition()).toBeGreaterThanOrEqual(1000);
    expect(engine.readPosition()).toBeLessThan(1300);
  });

  it("replaces a scheduled song start when seeking into the overlap", async () => {
    const { engine, slot, song } = await setup(true);
    const first = new AbortController();
    await engine.set(slot, 0, true, first.signal, () => {});
    expect(song().paused).toBe(true);
    first.abort();
    await engine.set(slot, 1900, false, new AbortController().signal, () => {});
    expect(song().currentTime).toBeCloseTo(0.4, 2);
    // Wait beyond the old music timer. It must not play or seek this paused run.
    await new Promise((resolve) => setTimeout(resolve, 1700));
    expect(song().paused).toBe(true);
    expect(song().currentTime).toBeCloseTo(0.4, 2);
  });

  it("rejects a stale native ended event when the current song is not ended", async () => {
    const { engine, slot, song } = await setup();
    const events = vi.fn((_event: EngineEvent) => {});
    await engine.set(slot, 2500, true, new AbortController().signal, events);
    song().dispatchEvent(new Event("ended"));
    expect(events.mock.calls.some(([event]) => event.type === "ended")).toBe(false);
  });

  it("keeps a cancelled native play promise from starting voice sources later", async () => {
    const { engine, slot, song } = await setup();
    const starts = vi.spyOn(AudioBufferSourceNode.prototype, "start");
    // Prepare the actual element first, then delay its play confirmation.
    await engine.set(slot, 500, false, new AbortController().signal, () => {});
    let complete!: () => void;
    vi.spyOn(song(), "play").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const signal = new AbortController();
    const pending = engine.set(slot, 500, true, signal.signal, () => {});
    await expect.poll(() => typeof complete).toBe("function");
    signal.abort();
    complete();
    await pending;
    expect(starts).not.toHaveBeenCalled();
    expect(song().paused).toBe(true);
  });

  it("the real controller preserves a paused song seek and resumes the whole mix there", async () => {
    const { engine, slot, song } = await setup();
    const player = new Player(engine);
    player.load(slot.id, () => Promise.resolve(slot));
    await expect.poll(() => player.getSnapshot().phase).toBe("ready");
    player.pause();
    player.seek({ coordinate: "song", ms: 1000 });
    await expect.poll(() => player.getSnapshot().phase).toBe("ready");
    expect(song().paused).toBe(true);
    expect(song().currentTime).toBeCloseTo(1, 2);
    player.play();
    await expect.poll(() => player.getSnapshot().phase).toBe("ready");
    expect(song().currentTime).toBeGreaterThanOrEqual(1);
    expect(song().currentTime).toBeLessThan(1.4);
    player.dispose();
  });
});
