import { describe, expect, it } from "vitest";
import { checkProgram } from "./rules";
import type { Slot } from "./shapes";

/**
 * The law over the writer's program: slot 1 is the break, a break elsewhere is a sweeper, a
 * talk-up needs a card with a long enough intro, a segue says nothing, and words that are
 * missing where they are needed step the slot down. Every downgrade is recorded as a fallback.
 */

const tracks = [{ id: "a" }, { id: "b" }, { id: "c" }];
const raw = (kinds: Slot["kind"][], words = "some words"): Slot[] =>
  kinds.map((kind) => ({
    kind,
    words: kind === "segue" ? "" : words,
    leadLine: "",
    recordUnderSec: 3,
    voiceInSec: 1.5,
    why: "w",
  }));

describe("checkProgram", () => {
  it("keeps a lawful program as written and assigns 1-based seqs and track ids", () => {
    const cards = new Map([["b", { introMs: 12_000 }]]);
    const out = checkProgram(raw(["break", "talkup", "segue"]), tracks, cards, null);
    expect(out.map((s) => [s.seq, s.trackId, s.kind])).toEqual([
      [1, "a", "break"],
      [2, "b", "talkup"],
      [3, "c", "segue"],
    ]);
    expect(out.every((s) => s.fallback === undefined)).toBe(true);
  });

  it.each([
    {
      id: "slot 1 that is not a break becomes the break",
      kinds: ["talkup", "segue"] as Slot["kind"][],
      seq: 1,
      want: { kind: "break", from: "talkup" },
    },
    {
      id: "a break past slot 1 becomes a sweeper",
      kinds: ["break", "break"] as Slot["kind"][],
      seq: 2,
      want: { kind: "sweeper", from: "break" },
    },
    {
      id: "a talk-up with no card becomes a segue",
      kinds: ["break", "talkup"] as Slot["kind"][],
      seq: 2,
      want: { kind: "segue", from: "talkup" },
    },
  ])("$id", ({ kinds, seq, want }) => {
    const out = checkProgram(raw(kinds), tracks.slice(0, kinds.length), new Map(), null);
    const slot = out[seq - 1];
    expect(slot.kind).toBe(want.kind);
    expect(slot.fallback?.from).toBe(want.from);
    expect(slot.fallback?.to).toBe(want.kind);
  });

  it("a talk-up over a short intro becomes a segue, naming the length", () => {
    const cards = new Map([["b", { introMs: 3000 }]]);
    const out = checkProgram(raw(["break", "talkup"]), tracks.slice(0, 2), cards, null);
    expect(out[1].kind).toBe("segue");
    expect(out[1].fallback?.reason).toContain("3000");
  });

  it("a talk-up or sweeper with no words becomes a segue; the break keeps its kind", () => {
    const cards = new Map([["b", { introMs: 12_000 }]]);
    const out = checkProgram(raw(["break", "talkup", "sweeper"], "  "), tracks, cards, null);
    expect(out[0].kind).toBe("break");
    expect(out[1].kind).toBe("segue");
    expect(out[1].fallback?.reason).toBe("no words");
    expect(out[2].kind).toBe("segue");
  });

  it("a segue carries no words, lead line or legal ID", () => {
    const out = checkProgram(
      [
        { kind: "break", words: "x", leadLine: "y", recordUnderSec: 0, voiceInSec: 0, why: "w" },
        { kind: "segue", words: "ignored", leadLine: "ignored", recordUnderSec: 0, voiceInSec: 0, why: "w" },
      ],
      tracks.slice(0, 2),
      new Map(),
      "WXYZ",
    );
    expect(out[1]).toMatchObject({ kind: "segue", words: null, leadLine: null, legalId: null });
  });

  it("the legal ID lands on slot 1 only, and only when given", () => {
    const withId = checkProgram(raw(["break", "sweeper"]), tracks.slice(0, 2), new Map(), "WXYZ, Dallas.");
    expect(withId[0].legalId).toBe("WXYZ, Dallas.");
    expect(withId[1].legalId).toBeNull();
    const without = checkProgram(raw(["break"]), tracks.slice(0, 1), new Map(), null);
    expect(without[0].legalId).toBeNull();
  });

  it("the break keeps its lead line trimmed; other kinds drop theirs", () => {
    const out = checkProgram(
      [
        { kind: "break", words: "x", leadLine: "  lead in  ", recordUnderSec: 0, voiceInSec: 0, why: "w" },
        { kind: "sweeper", words: "id", leadLine: "stray", recordUnderSec: 0, voiceInSec: 0, why: "w" },
      ],
      tracks.slice(0, 2),
      new Map(),
      null,
    );
    expect(out[0].leadLine).toBe("lead in");
    expect(out[1].leadLine).toBeNull();
  });

  it("throws when the program and the tracks disagree in length", () => {
    expect(() => checkProgram(raw(["break"]), tracks, new Map(), null)).toThrow(/3 tracks/);
  });

  describe("the writer's timing numbers land only where they mean something, clamped", () => {
    const cards = new Map([["b", { introMs: 12_000 }]]);
    it.each([
      {
        id: "a break keeps recordUnder, drops voiceIn",
        kinds: ["break"] as Slot["kind"][],
        want: [3000, null],
      },
      {
        id: "a talk-up keeps voiceIn, drops recordUnder",
        kinds: ["break", "talkup"] as Slot["kind"][],
        want: [null, 1500],
      },
      { id: "a segue carries neither", kinds: ["break", "segue"] as Slot["kind"][], want: [null, null] },
    ])("$id", ({ kinds, want }) => {
      const out = checkProgram(raw(kinds), tracks.slice(0, kinds.length), cards, null);
      const last = out[out.length - 1];
      expect([last.recordUnderMs, last.voiceInMs]).toEqual(want);
    });

    it.each([
      { id: "negative is 0", give: -2, want: 0 },
      { id: "past the cap is the cap", give: 99, want: 10_000 },
      { id: "NaN is 0", give: Number.NaN, want: 0 },
      { id: "rounded to the ms", give: 2.5005, want: 2501 },
    ])("$id", ({ give, want }) => {
      const [b] = raw(["break"]);
      const out = checkProgram([{ ...b, recordUnderSec: give }], tracks.slice(0, 1), new Map(), null);
      expect(out[0].recordUnderMs).toBe(want);
    });
  });
});
