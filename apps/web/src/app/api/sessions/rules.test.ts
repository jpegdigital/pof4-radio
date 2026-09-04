import { describe, expect, it } from "vitest";
import { checkSlot, isBreak, legalIdDue, MAX_RECORD_UNDER_MS, MAX_VOICE_IN_MS } from "./rules";
import type { Written } from "./shapes";

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

const written = (over: Partial<Written> = {}): Written => ({
  pick: "a",
  rampSec: 12,
  sure: true,
  post: "the title line",
  outro: "fade",
  outroSec: 200,
  energy: 3,
  tempo: "mid",
  mood: "easy",
  kind: "talkup",
  words: "some words",
  leadLine: "",
  treatment: "why",
  recordUnderSec: 3,
  voiceInSec: 1.5,
  ...over,
});

const hit = { durationMs: 230_000 };

describe("checkSlot — the kind", () => {
  it.each<{
    id: string;
    clockSaysBreak: boolean;
    give: Partial<Written>;
    kind: string;
    fallback: { from: string; to: string; reason: RegExp } | null;
  }>([
    {
      id: "the clock says break and the writer wrote one",
      clockSaysBreak: true,
      give: { kind: "break", leadLine: "here it is" },
      kind: "break",
      fallback: null,
    },
    {
      id: "the clock says break and the writer wrote a talk-up",
      clockSaysBreak: true,
      give: { kind: "talkup" },
      kind: "break",
      fallback: { from: "talkup", to: "break", reason: /break/ },
    },
    {
      id: "the clock says no break and the writer wrote one",
      clockSaysBreak: false,
      give: { kind: "break", leadLine: "x" },
      kind: "sweeper",
      fallback: { from: "break", to: "sweeper", reason: /not a break/ },
    },
    {
      id: "a talk-up with a long ramp the writer is sure of",
      clockSaysBreak: false,
      give: { kind: "talkup", rampSec: 12, sure: true },
      kind: "talkup",
      fallback: null,
    },
    {
      id: "a talk-up the writer is unsure of",
      clockSaysBreak: false,
      give: { kind: "talkup", rampSec: 12, sure: false },
      kind: "segue",
      fallback: { from: "talkup", to: "segue", reason: /unsure of the ramp/ },
    },
    {
      id: "a talk-up over a short ramp",
      clockSaysBreak: false,
      give: { kind: "talkup", rampSec: 5, sure: true },
      kind: "segue",
      fallback: { from: "talkup", to: "segue", reason: /ramp too short/ },
    },
    {
      id: "a sweeper with nothing to say",
      clockSaysBreak: false,
      give: { kind: "sweeper", words: "   " },
      kind: "segue",
      fallback: { from: "sweeper", to: "segue", reason: /no words/ },
    },
    {
      id: "a talk-up with nothing to say",
      clockSaysBreak: false,
      give: { kind: "talkup", words: "" },
      kind: "segue",
      fallback: { from: "talkup", to: "segue", reason: /no words/ },
    },
    {
      id: "a segue is a segue",
      clockSaysBreak: false,
      give: { kind: "segue", words: "ignored" },
      kind: "segue",
      fallback: null,
    },
  ])("$id", ({ clockSaysBreak, give, kind, fallback }) => {
    const out = checkSlot(clockSaysBreak, written(give), hit, null);
    expect(out.kind).toBe(kind);
    if (fallback) {
      expect(out.fallback?.from).toBe(fallback.from);
      expect(out.fallback?.to).toBe(fallback.to);
      expect(out.fallback?.reason).toMatch(fallback.reason);
    } else expect(out.fallback).toBeNull();
  });

  it("a break with no words stays a break (the writer's copy is the break's)", () => {
    const out = checkSlot(true, written({ kind: "break", words: "", leadLine: "" }), hit, null);
    expect(out.kind).toBe("break");
  });
});

describe("checkSlot — the copy", () => {
  it("a segue carries no words, no lead line, no legal ID", () => {
    const out = checkSlot(false, written({ kind: "segue", words: "x", leadLine: "y" }), hit, "WXYZ");
    expect(out).toMatchObject({ words: null, leadLine: null, legalId: null });
  });

  it("the break keeps its lead line trimmed; other kinds drop theirs", () => {
    expect(checkSlot(true, written({ kind: "break", leadLine: "  lead in  " }), hit, null).leadLine).toBe(
      "lead in",
    );
    expect(checkSlot(false, written({ kind: "sweeper", leadLine: "stray" }), hit, null).leadLine).toBeNull();
  });

  it("the pick and the treatment pass through", () => {
    const out = checkSlot(false, written({ pick: "z", treatment: "because" }), hit, null);
    expect(out.qobuzId).toBe("z");
    expect(out.treatment).toBe("because");
  });
});

describe("checkSlot — the legal ID", () => {
  it.each<{
    id: string;
    clockSaysBreak: boolean;
    kind: Written["kind"];
    legalId: string | null;
    want: string | null;
  }>([
    {
      id: "a break when due",
      clockSaysBreak: true,
      kind: "break",
      legalId: "WXYZ, Dallas.",
      want: "WXYZ, Dallas.",
    },
    { id: "a break when not due", clockSaysBreak: true, kind: "break", legalId: null, want: null },
    { id: "a sweeper never", clockSaysBreak: false, kind: "sweeper", legalId: "WXYZ", want: null },
    { id: "a talk-up never", clockSaysBreak: false, kind: "talkup", legalId: "WXYZ", want: null },
  ])("$id", ({ clockSaysBreak, kind, legalId, want }) => {
    expect(checkSlot(clockSaysBreak, written({ kind }), hit, legalId).legalId).toBe(want);
  });
});

describe("checkSlot — the timing, only where it means something, clamped", () => {
  it.each<{
    id: string;
    clockSaysBreak: boolean;
    give: Partial<Written>;
    want: [number | null, number | null];
  }>([
    { id: "a break keeps recordUnder", clockSaysBreak: true, give: { kind: "break" }, want: [3000, null] },
    { id: "a talk-up keeps voiceIn", clockSaysBreak: false, give: { kind: "talkup" }, want: [null, 1500] },
    { id: "a sweeper carries neither", clockSaysBreak: false, give: { kind: "sweeper" }, want: [null, null] },
    { id: "a segue carries neither", clockSaysBreak: false, give: { kind: "segue" }, want: [null, null] },
    {
      id: "a break past the cap is the cap",
      clockSaysBreak: true,
      give: { kind: "break", recordUnderSec: 30 },
      want: [MAX_RECORD_UNDER_MS, null],
    },
    {
      id: "a talk-up past the cap is the cap",
      clockSaysBreak: false,
      give: { kind: "talkup", voiceInSec: 99 },
      want: [null, MAX_VOICE_IN_MS],
    },
    {
      id: "negative is 0",
      clockSaysBreak: true,
      give: { kind: "break", recordUnderSec: -2 },
      want: [0, null],
    },
    {
      id: "NaN is 0",
      clockSaysBreak: true,
      give: { kind: "break", recordUnderSec: Number.NaN },
      want: [0, null],
    },
  ])("$id", ({ clockSaysBreak, give, want }) => {
    const out = checkSlot(clockSaysBreak, written(give), hit, null);
    expect([out.recordUnderMs, out.voiceInMs]).toEqual(want);
  });
});

describe("checkSlot — the chart, in ms, clamped to the hit", () => {
  it("ramp and outro become ms and never run past the hit's length", () => {
    const out = checkSlot(false, written({ rampSec: 400, outroSec: 999 }), hit, null);
    expect(out.rampMs).toBe(hit.durationMs);
    expect(out.outroMs).toBe(hit.durationMs);
  });

  it("the feel passes through", () => {
    const out = checkSlot(
      false,
      written({ rampSec: 12.4, outroSec: 200, energy: 4, tempo: "up", mood: "big" }),
      hit,
      null,
    );
    expect(out).toMatchObject({
      rampMs: 12_400,
      outroMs: 200_000,
      energy: 4,
      tempo: "up",
      mood: "big",
      sure: true,
      post: "the title line",
      outro: "fade",
    });
  });

  it("a negative ramp is 0", () => {
    expect(checkSlot(false, written({ rampSec: -3 }), hit, null).rampMs).toBe(0);
  });
});
