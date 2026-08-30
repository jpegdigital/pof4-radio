import { describe, expect, it } from "vitest";
import { assemble, type AssembleInput, type ClipInfo } from "./assemble";
import { BEAT_MS, TALKUP_LATE_MS } from "./clock-rules";
import { type Card, type Line, type LogSlot, Program, type Record } from "./shapes";

const rec = (id: string): Record => ({
  id,
  uri: `spotify:track:${id}`,
  name: id,
  artists: [id],
  album: id,
  image: null,
  durationMs: 200_000,
  pick: 0,
});
const card = (id: string, introMs = 14_000, sure = true): Card => ({
  id,
  name: id,
  artists: [id],
  introMs,
  sure,
  post: "post",
  outro: "fade",
  outroMs: 180_000,
  energy: 3,
  tempo: "mid",
  mood: "",
  notes: [],
  thinking: "",
  enrichedAt: "",
  model: "",
});
const slot = (seq: number, id: string, intro: LogSlot["intro"], topOfHour = false): LogSlot => ({
  seq,
  id,
  intro,
  topOfHour,
  why: "",
});

const request = {
  request: "r",
  station: { onAir: "56.6, Claude Radio", calls: "WFAI", city: "Dallas" },
  dj: "M",
  startMs: 0,
  count: 10,
};

function build(
  slots: LogSlot[],
  lines: Line[],
  clips: [number, ClipInfo][],
  extra: Partial<AssembleInput> = {},
) {
  const records = slots.map((s) => rec(s.id));
  return assemble({
    request,
    records,
    cards: new Map(records.map((r) => [r.id, card(r.id)])),
    log: { slots, fallbacks: [], crossesHour: false, hourAtSeq: null },
    script: { lines },
    clips: new Map(clips),
    sweepers: [],
    voiceId: "v",
    madeAt: "t",
    ...extra,
  });
}

describe("assemble", () => {
  it("a break with a legal ID and a lead: bed in at the ID's end, song under the last line", () => {
    const p = build(
      [slot(0, "a", "break", true)],
      [{ seq: 0, legalId: "WFAI, Dallas.", words: "words", leadLine: "lead" }],
      [[0, { clipMs: 30_000, bedInMs: 2000, leadMs: 1800 }]],
    );
    expect(p.elements[0]).toEqual({
      kind: "break",
      clip: "slot-0",
      bed: "bed",
      bedInMs: 2000,
      leadMs: 1800,
      label: "Top of the hour → a — a",
    });
    expect(p.elements[1]).toMatchObject({ kind: "song" });
    expect(p.notes[0]).toMatchObject({
      element: 0,
      seq: 0,
      treatment: "break",
      clip: "slot-0",
      clipMs: 30_000,
      bedInMs: 2000,
      leadMs: 1800,
    });
    expect(p.notes[0]?.fallback).toBeUndefined();
    expect(Program.safeParse(p).success).toBe(true);
  });

  it("no lead line → hand-off at the clip's end", () => {
    const p = build([slot(0, "a", "break")], [{ seq: 0, words: "words" }], [[0, { clipMs: 30_000 }]]);
    expect(p.elements[0]).toMatchObject({ kind: "break", leadMs: 0 });
    expect(p.notes[0]?.fallback).toEqual({ from: "lead", to: "end", reason: "no lead line" });
  });

  it("a lead line without a usable alignment → hand-off at the clip's end", () => {
    const p = build(
      [slot(0, "a", "break")],
      [{ seq: 0, words: "words", leadLine: "lead" }],
      [[0, { clipMs: 30_000, leadMs: 40_000 }]],
    );
    expect(p.elements[0]).toMatchObject({ leadMs: 0 });
    expect(p.notes[0]?.fallback).toMatchObject({
      from: "lead",
      to: "end",
      reason: "no alignment for the lead line",
    });
  });

  it("a top-of-the-hour break without a legal ID → bed in at the start, and says so", () => {
    const p = build(
      [slot(0, "a", "break", true)],
      [{ seq: 0, words: "words", leadLine: "lead" }],
      [[0, { clipMs: 30_000, leadMs: 1800 }]],
    );
    expect(p.elements[0]).toMatchObject({ bedInMs: undefined, leadMs: 1800 });
    expect(p.notes[0]?.fallback).toEqual({ from: "bedIn", to: "start", reason: "no legal ID" });
  });

  it("a break with no words → a produced sweeper if there is one, else a segue", () => {
    const withSweeper = build([slot(0, "a", "break")], [], [], { sweepers: ["sweep-hits"] });
    expect(withSweeper.elements[0]).toEqual({
      kind: "break",
      clip: "sweepers/sweep-hits",
      leadMs: 0,
      label: "Sweeper → a — a",
    });
    expect(withSweeper.notes[0]?.fallback).toEqual({ from: "break", to: "sweeper", reason: "no words" });
    const none = build([slot(0, "a", "break")], [], []);
    expect(none.elements).toEqual([{ kind: "song", track: rec("a") }]);
    expect(none.notes[0]?.fallback).toEqual({ from: "break", to: "segue", reason: "no words" });
  });

  it("a break whose clip failed → the same ladder, naming the error", () => {
    const p = build([slot(0, "a", "break")], [{ seq: 0, words: "w" }], [[0, { error: "elevenlabs 401" }]]);
    expect(p.elements).toEqual([{ kind: "song", track: rec("a") }]);
    expect(p.notes[0]?.fallback).toEqual({
      from: "break",
      to: "segue",
      reason: "clip failed: elevenlabs 401",
    });
  });

  it("a talk-up lands the post when the card is sure and the clip fits", () => {
    const p = build([slot(0, "a", "talkup")], [{ seq: 0, words: "w" }], [[0, { clipMs: 5000 }]]);
    const at = 14_000 - 5000 - BEAT_MS;
    expect(p.elements[0]).toEqual({
      kind: "song",
      track: rec("a"),
      talk: { clip: "slot-0", over: "intro", atMs: at },
    });
    expect(p.notes[0]).toMatchObject({ treatment: "talkup", atMs: at });
    expect(p.notes[0]?.fallback).toBeUndefined();
  });

  it("a talk-up longer than the intro comes in late instead", () => {
    const p = build([slot(0, "a", "talkup")], [{ seq: 0, words: "w" }], [[0, { clipMs: 9000 }]], {
      cards: new Map([["a", card("a", 7000)]]),
    });
    expect(p.elements[0]).toMatchObject({ talk: { atMs: TALKUP_LATE_MS } });
    expect(p.notes[0]?.fallback).toEqual({
      from: "post",
      to: "late",
      reason: "9000 ms clip over a 7000 ms intro",
    });
  });

  it("a talk-up over an unsure card comes in late", () => {
    const p = build([slot(0, "a", "talkup")], [{ seq: 0, words: "w" }], [[0, { clipMs: 3000 }]], {
      cards: new Map([["a", card("a", 14_000, false)]]),
    });
    expect(p.elements[0]).toMatchObject({ talk: { atMs: TALKUP_LATE_MS } });
    expect(p.notes[0]?.fallback).toMatchObject({ from: "post", to: "late", reason: "card not sure" });
  });

  it("a talk-up whose clip failed is a plain song", () => {
    const p = build([slot(0, "a", "talkup")], [{ seq: 0, words: "w" }], [[0, { error: "boom" }]]);
    expect(p.elements[0]).toEqual({ kind: "song", track: rec("a") });
    expect(p.notes[0]?.fallback).toEqual({ from: "late", to: "none", reason: "clip failed: boom" });
  });

  it("a sweeper: voiced when there are words, produced (round-robin) when there are none, a segue when neither", () => {
    const voiced = build(
      [slot(0, "a", "sweeper")],
      [{ seq: 0, words: "Claude Radio!" }],
      [[0, { clipMs: 1500 }]],
    );
    expect(voiced.elements[0]).toEqual({
      kind: "break",
      clip: "slot-0",
      leadMs: 0,
      label: "Sweeper → a — a",
    });
    expect(voiced.notes[0]?.fallback).toBeUndefined();
    const produced = build(
      [slot(0, "a", "sweeper"), slot(1, "b", "sweeper"), slot(2, "c", "sweeper")],
      [],
      [],
      { sweepers: ["x", "y"] },
    );
    expect(
      produced.elements.filter((e) => e.kind === "break").map((e) => (e.kind === "break" ? e.clip : "")),
    ).toEqual(["sweepers/x", "sweepers/y", "sweepers/x"]);
    expect(produced.notes.every((n) => n.fallback === undefined)).toBe(true);
    const none = build([slot(0, "a", "sweeper")], [], []);
    expect(none.elements).toEqual([{ kind: "song", track: rec("a") }]);
    expect(none.notes[0]?.fallback).toEqual({ from: "sweeper", to: "segue", reason: "no words" });
  });

  it("everything fallen back is still a valid program with one song per record", () => {
    const slots = [
      slot(0, "a", "break", true),
      slot(1, "b", "talkup"),
      slot(2, "c", "sweeper"),
      slot(3, "d", "segue"),
      slot(4, "e", "break"),
    ];
    const p = build(
      slots,
      [
        { seq: 0, words: "w" },
        { seq: 1, words: "w" },
        { seq: 2, words: "w" },
        { seq: 4, words: "w" },
      ],
      [
        [0, { error: "e" }],
        [1, { error: "e" }],
        [2, { error: "e" }],
        [4, { error: "e" }],
      ],
    );
    expect(Program.safeParse(p).success).toBe(true);
    expect(
      p.elements.filter((e) => e.kind === "song").map((e) => (e.kind === "song" ? e.track.name : "")),
    ).toEqual(["a", "b", "c", "d", "e"]);
    expect(p.notes.length).toBe(4);
    expect(p.notes.every((n) => n.fallback)).toBe(true);
  });

  it("notes[i].element points at the element carrying that clip", () => {
    const p = build(
      [slot(0, "a", "break"), slot(1, "b", "talkup"), slot(2, "c", "segue"), slot(3, "d", "sweeper")],
      [
        { seq: 0, words: "w", leadLine: "l" },
        { seq: 1, words: "w" },
        { seq: 3, words: "w" },
      ],
      [
        [0, { clipMs: 20_000, leadMs: 1500 }],
        [1, { clipMs: 4000 }],
        [3, { clipMs: 1500 }],
      ],
    );
    for (const n of p.notes) {
      const el = p.elements[n.element];
      expect(el).toBeDefined();
      const clip = el?.kind === "break" ? el.clip : el?.talk?.clip;
      expect(clip).toBe(n.clip);
    }
  });
});
