import { describe, expect, it, vi } from "vitest";
import { positionAt, ScrubGesture, type ScrubSnapshot } from "./scrub";

const snapshot: ScrubSnapshot = {
  cueId: "one",
  positionMs: 1000,
  durationMs: 180_000,
  operationId: 1,
  seeking: false,
};
describe("scrub gesture", () => {
  it("holds the released target until its seek is acknowledged", () => {
    const gesture = new ScrubGesture();
    const commit = vi.fn(() => 2);
    gesture.begin("one", 1, 80_000);
    gesture.release("one", 1, 90_000, commit);
    expect(commit).toHaveBeenCalledExactlyOnceWith(90_000);
    expect(gesture.shown(snapshot)).toBe(90_000);
    expect(gesture.shown({ ...snapshot, operationId: 2, seeking: true })).toBe(90_000);
    expect(gesture.shown({ ...snapshot, operationId: 2, positionMs: 90_040 })).toBe(90_040);
  });
  it("ignores other pointers, duplicate releases and lost capture after a commit", () => {
    const gesture = new ScrubGesture();
    const commit = vi.fn(() => 2);
    gesture.begin("one", 1, 5000);
    expect(gesture.begin("one", 2, 6000)).toBe(false);
    gesture.move("one", 2, 7000);
    gesture.release("one", 2, 7000, commit);
    expect(gesture.shown(snapshot)).toBe(5000);
    gesture.release("one", 1, 5000, commit);
    gesture.cancel("one", 1);
    gesture.release("one", 1, 6000, commit);
    expect(commit).toHaveBeenCalledOnce();
    expect(gesture.shown(snapshot)).toBe(5000);
  });
  it("cancels without committing and cannot seek another cue on release", () => {
    const gesture = new ScrubGesture();
    const commit = vi.fn(() => 2);
    gesture.begin("one", 1, 5000);
    gesture.release("two", 1, 5000, commit);
    expect(gesture.shown({ ...snapshot, cueId: "two" })).toBe(1000);
    gesture.cancel("one", 1);
    gesture.release("one", 1, 5000, commit);
    expect(commit).not.toHaveBeenCalled();
  });
  it("a newer operation or failure replaces the pending preview", () => {
    const gesture = new ScrubGesture();
    gesture.commit("one", 90_000, () => 2);
    expect(gesture.shown({ ...snapshot, operationId: 3, positionMs: 5000 })).toBe(5000);
    expect(gesture.shown({ ...snapshot, operationId: 2, positionMs: 1000 })).toBe(1000);
  });
  it("maps geometry safely", () => {
    expect(positionAt(50, 0, 100, 10_000)).toBe(5000);
    expect(positionAt(-50, 0, 100, 10_000)).toBe(0);
    expect(positionAt(150, 0, 100, 10_000)).toBe(10_000);
    expect(positionAt(50, 0, 0, 10_000)).toBeNull();
    expect(positionAt(50, 0, 100, Number.NaN)).toBeNull();
  });
});
