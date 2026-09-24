import { describe, expect, it, vi } from "vitest";
import { Player } from "./player";
import { planSlot } from "./plan";
import { mixAt, type PreparedSlot } from "./mix";
import type { AudioEngine, EngineEvent } from "./engine";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

class FakeEngine implements AudioEngine {
  position = 0;
  requests: {
    slot: PreparedSlot;
    at: number;
    playing: boolean;
    signal: AbortSignal;
    emit: (e: EngineEvent) => void;
    done: ReturnType<typeof deferred>;
  }[] = [];
  unlock = vi.fn();
  dispose = vi.fn();
  stop() {
    return this.position;
  }
  readPosition() {
    return this.position;
  }
  set(slot: PreparedSlot, at: number, playing: boolean, signal: AbortSignal, emit: (e: EngineEvent) => void) {
    const done = deferred();
    this.requests.push({ slot, at, playing, signal, emit, done });
    return done.promise;
  }
}

const slot: PreparedSlot = {
  id: "session/1/take",
  songUrl: "blob:song",
  voiceUrl: "blob:voice",
  bedUrl: null,
  songDurationMs: 180_000,
  plan: planSlot({ kind: "talkup", clipMs: 10_000, recordUnderMs: 5000, legalIdChars: 0 }),
};
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
async function setup() {
  const engine = new FakeEngine();
  const voiceEnded = vi.fn();
  const player = new Player(engine, voiceEnded);
  player.load(slot.id, () => Promise.resolve(slot));
  await flush();
  engine.requests[0].done.resolve();
  await flush();
  return { engine, player, voiceEnded };
}

describe("one player, two seek coordinates", () => {
  it("a late load cannot replace the current cue, including after disposal", async () => {
    const engine = new FakeEngine();
    const player = new Player(engine);
    let finish!: (slot: PreparedSlot) => void;
    player.load(
      "old",
      () =>
        new Promise<PreparedSlot>((resolve) => {
          finish = resolve;
        }),
    );
    player.load(slot.id, () => Promise.resolve(slot));
    await flush();
    finish({ ...slot, id: "old" });
    await flush();
    expect(engine.requests).toHaveLength(1);
    expect(player.getSnapshot().id).toBe(slot.id);
    player.dispose();
    engine.requests[0].done.resolve();
    await flush();
    expect(player.getSnapshot().phase).toBe("empty");
  });
  it("pause during load remains paused after preparation", async () => {
    const engine = new FakeEngine();
    const player = new Player(engine);
    player.load(slot.id, () => Promise.resolve(slot));
    player.pause();
    await flush();
    expect(engine.requests[0].playing).toBe(false);
  });
  it("accepts a natural completion once and preserves the wait through pause/play", async () => {
    const { player, engine } = await setup();
    const changes = vi.fn();
    player.subscribe(changes);
    engine.requests[0].emit({ type: "ended" });
    engine.requests[0].emit({ type: "ended" });
    expect(changes).toHaveBeenCalledOnce();
    expect(player.getSnapshot().phase).toBe("ended");
    player.pause();
    player.play();
    expect(player.getSnapshot()).toMatchObject({ phase: "ended", intent: "play" });
    expect(engine.requests).toHaveLength(1);
  });
  it("manual pause during an interruption prevents automatic recovery", async () => {
    const { player, engine } = await setup();
    const old = engine.requests[0];
    old.emit({ type: "interrupted", positionMs: 18_000 });
    player.pause();
    const paused = engine.requests.at(-1)!;
    old.emit({ type: "recovered" });
    paused.done.resolve();
    await flush();
    expect(player.getSnapshot()).toMatchObject({ phase: "ready", status: "paused", positionMs: 18_000 });
  });
  it("current play failures stop the engine and publish a recoverable error", async () => {
    const { player, engine } = await setup();
    player.seek({ coordinate: "song", ms: 5000 });
    const failed = engine.requests.at(-1)!;
    failed.done.reject(new Error("play denied"));
    await flush();
    expect(failed.signal.aborted).toBe(true);
    expect(player.getSnapshot()).toMatchObject({
      phase: "failed",
      error: "play denied",
      positionMs: 0,
      retryPositionMs: 10_000,
    });
    player.play();
    expect(engine.requests.at(-1)).toMatchObject({ at: 10_000, playing: true });
  });
  it("seeks all lanes when the song is scrubbed into the DJ overlap", async () => {
    const { player, engine } = await setup();
    player.seek({ coordinate: "song", ms: 2000 });
    const request = engine.requests.at(-1)!;
    expect(request.at).toBe(7000);
    expect(mixAt(slot, request.at).voice.offsetMs).toBe(7000);
    expect(mixAt(slot, request.at).song.offsetMs).toBe(2000);
    expect(player.getSnapshot()).toMatchObject({ phase: "seeking", positionMs: 7000 });
  });

  it.each(["slot", "song"] as const)(
    "pause -> %s seek -> play uses the committed destination",
    async (coordinate) => {
      const { player, engine } = await setup();
      engine.position = 60_000;
      player.pause();
      player.seek({ coordinate, ms: 2000 });
      expect(engine.requests.at(-1)!.playing).toBe(false);
      engine.requests.at(-1)!.done.resolve();
      await flush();
      player.play();
      expect(engine.requests.at(-1)).toMatchObject({
        at: coordinate === "song" ? 7000 : 2000,
        playing: true,
      });
    },
  );

  it("ignores superseded completion, telemetry, errors and ended events", async () => {
    const { player, engine, voiceEnded } = await setup();
    player.seek({ coordinate: "song", ms: 30_000 });
    const old = engine.requests.at(-1)!;
    player.seek({ coordinate: "song", ms: 90_000 });
    const current = engine.requests.at(-1)!;
    expect(old.signal.aborted).toBe(true);
    old.emit({ type: "position", positionMs: 1000 });
    old.emit({ type: "ended" });
    old.emit({ type: "voice-ended" });
    old.done.reject(new Error("old play failed"));
    current.done.resolve();
    await flush();
    expect(player.getSnapshot()).toMatchObject({ phase: "ready", positionMs: 95_000, status: "playing" });
    expect(voiceEnded).not.toHaveBeenCalled();
  });

  it("pause during pending seek preserves its target and cannot start late", async () => {
    const { player, engine } = await setup();
    player.seek({ coordinate: "song", ms: 20_000 });
    const old = engine.requests.at(-1)!;
    player.pause();
    old.done.resolve();
    await flush();
    expect(engine.requests.at(-1)).toMatchObject({ at: 25_000, playing: false });
    expect(player.getSnapshot()).toMatchObject({ intent: "pause", positionMs: 25_000 });
  });

  it("keeps the requested target while old observations arrive during preparation", async () => {
    const { player, engine } = await setup();
    player.seek({ coordinate: "song", ms: 90_000 });
    engine.requests[0].emit({ type: "position", positionMs: 1000 });
    expect(player.getSnapshot().positionMs).toBe(95_000);
  });

  it("does not clamp recovery to the mixer preview or override a manual pause", async () => {
    const { player, engine } = await setup();
    const run = engine.requests[0];
    run.emit({ type: "interrupted", positionMs: 95_000 });
    run.emit({ type: "recovered" });
    expect(engine.requests.at(-1)!.at).toBe(95_000);
    player.pause();
    const count = engine.requests.length;
    run.emit({ type: "recovered" });
    expect(engine.requests).toHaveLength(count);
    expect(player.getSnapshot().intent).toBe("pause");
  });

  it("makes exact-end seeks explicit and does not prepare unplayable audio", async () => {
    const { player, engine } = await setup();
    const count = engine.requests.length;
    player.seek({ coordinate: "song", ms: 180_000 });
    expect(player.getSnapshot()).toMatchObject({ phase: "ended", positionMs: 185_000 });
    expect(engine.requests).toHaveLength(count);
    player.seek({ coordinate: "song", ms: 30_000 });
    expect(engine.requests.at(-1)!.at).toBe(35_000);
  });

  it("disposal invalidates pending loads and engine events", async () => {
    const { player, engine } = await setup();
    player.dispose();
    engine.requests[0].emit({ type: "ended" });
    expect(player.getSnapshot().phase).toBe("empty");
    expect(engine.dispose).toHaveBeenCalledOnce();
  });
});
