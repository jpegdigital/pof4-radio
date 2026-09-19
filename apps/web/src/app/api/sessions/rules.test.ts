import { describe, expect, it } from "vitest";
import { checkSlot, isBreak, legalIdDue } from "./rules";
import type { MixPlan } from "./planning";

/**
 * The law over one slot: the clock says whether it is the break, a talk-up needs a ramp the
 * writer is sure of, words that are missing where they are needed step the kind down, the
 * timing is clamped, and the legal ID lands only on a break when it is due.
 */

const HOUR = 3_600_000;

describe("isBreak — slot 1 and every breakEvery after", () => {
  it.each<[number, number, boolean]>([
    [1, 5, true],
    [2, 5, false],
    [5, 5, false],
    [6, 5, true],
    [11, 5, true],
    [1, 1, true],
    [3, 1, true],
    [4, 3, true],
    [5, 3, false],
  ])("seq %i, every %i → %s", (seq, every, want) => {
    expect(isBreak(seq, every)).toBe(want);
  });
});

describe("legalIdDue — slot 1, or when the hour turned since the last break", () => {
  it.each<{ id: string; seq: number; clockMs: number; last: number | null; want: boolean }>([
    { id: "slot 1 always", seq: 1, clockMs: 8 * HOUR + 5000, last: null, want: true },
    {
      id: "same hour as the last break",
      seq: 6,
      clockMs: 8 * HOUR + 40 * 60000,
      last: 8 * HOUR + 5000,
      want: false,
    },
    { id: "the hour turned", seq: 11, clockMs: 9 * HOUR + 2000, last: 8 * HOUR + 40 * 60000, want: true },
    { id: "no earlier break on record", seq: 6, clockMs: 8 * HOUR, last: null, want: true },
    { id: "the last minute of the hour", seq: 6, clockMs: 9 * HOUR - 1, last: 8 * HOUR, want: false },
  ])("$id", ({ seq, clockMs, last, want }) => {
    expect(legalIdDue(seq, clockMs, last)).toBe(want);
  });
});

const plan = (over: Partial<MixPlan> = {}): MixPlan => ({
  chart: {
    rampMs: 10000,
    sure: false,
    post: "Estimated",
    outro: "fade",
    outroMs: 190000,
    energy: 3,
    tempo: "mid",
    mood: "warm",
  },
  kind: "talkup",
  voiceInMs: 1000,
  recordUnderMs: null,
  wordsMax: 12,
  leadWordsMax: 0,
  treatment: "Jev action",
  ...over,
});
const hit = { id: "jev-picked", durationMs: 200000 };
describe("checkSlot — preserves Jev's plan", () => {
  it("combines fixed chart and timing with prose only", () => {
    const out = checkSlot(false, plan(), { words: "  Here comes the sun.  ", leadLine: "" }, hit, null);
    expect(out).toMatchObject({
      qobuzId: "jev-picked",
      kind: "talkup",
      rampMs: 10000,
      voiceInMs: 1000,
      words: "Here comes the sun.",
      fallback: null,
    });
  });
  it("puts the legal ID and lead line only on a planned break", () => {
    const out = checkSlot(
      true,
      plan({ kind: "break", voiceInMs: null, recordUnderMs: 3000, leadWordsMax: 8 }),
      { words: "Welcome back.", leadLine: " Here is the next track. " },
      hit,
      "WFAI, Dallas.",
    );
    expect(out).toMatchObject({
      legalId: "WFAI, Dallas.",
      leadLine: "Here is the next track.",
      recordUnderMs: 3000,
    });
  });
  it.each([
    { id: "empty copy", copy: { words: "", leadLine: "" } },
    { id: "overlong copy", copy: { words: "word ".repeat(13), leadLine: "" } },
    { id: "unexpected lead line", copy: { words: "Hello", leadLine: "Surprise" } },
  ])("fails on $id without selecting a different kind", ({ copy }) => {
    expect(() => checkSlot(false, plan(), copy, hit, null)).toThrow();
  });
  it("rejects a plan that violates the clock", () => {
    expect(() => checkSlot(true, plan(), { words: "Hi", leadLine: "" }, hit, null)).toThrow(/clock/);
  });
  it("a planned segue has no generated copy or legal ID", () => {
    expect(
      checkSlot(
        false,
        plan({ kind: "segue", voiceInMs: null, wordsMax: 0 }),
        { words: "", leadLine: "" },
        hit,
        "WFAI",
      ),
    ).toMatchObject({ kind: "segue", words: null, legalId: null, fallback: null });
    expect(() =>
      checkSlot(
        false,
        plan({ kind: "segue", wordsMax: 0 }),
        { words: "Unexpected", leadLine: "" },
        hit,
        null,
      ),
    ).toThrow();
  });
});
