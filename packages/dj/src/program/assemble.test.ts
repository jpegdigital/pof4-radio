import { describe, expect, it } from "vitest";
import { assemble, type AssembleInput } from "./assemble.ts";
import { BEAT_MS, TALKUP_LATE_MS } from "./clock-rules.ts";
import { type Card, type Line, type LogSlot, Note, type Record, SegmentLog } from "./shapes.ts";
import type { ClipInfo } from "./timings.ts";

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
  model: "",
});
const slot = (seq: number, id: string, intro: LogSlot["intro"]): LogSlot => ({ seq, id, intro, why: "" });
const url = (seq: number) => `/api/clip/seg/${seq}`;

function build(
  slots: LogSlot[],
  lines: Omit<Line, "treatment">[],
  clips: [number, ClipInfo][],
  extra: Partial<AssembleInput> & { topOfHour?: boolean } = {},
) {
  const records = slots.map((s) => rec(s.id));
  const { topOfHour = false, ...rest } = extra;
  const treatments = new Map(slots.map((s) => [s.seq, s.intro]));
  return assemble({
    records,
    lines: lines.map((l) => ({ ...l, treatment: treatments.get(l.seq) ?? "segue" })),
    log: { slots, fallbacks: [], topOfHour },
    cards: new Map(records.map((r) => [r.id, card(r.id)])),
    clips: new Map(clips),
    clipUrl: url,
    sweepers: [],
    bed: "/bed.mp3",
    ...rest,
  });
}

const valid = (out: { notes: Note[] }) => out.notes.every((n) => Note.safeParse(n).success);

describe("assemble", () => {
  it("a break with a legal ID and a lead: bed in at the ID's end, song under the last line", () => {
    const p = build(
      [slot(0, "a", "break")],
      [{ seq: 0, legalId: "WFAI, Dallas.", words: "words", leadLine: "lead" }],
      [[0, { clipMs: 30_000, bedInMs: 2000, leadMs: 1800 }]],
      { topOfHour: true },
    );
    expect(p.elements[0]).toEqual({
      kind: "break",
      clip: url(0),
      bed: "/bed.mp3",
      bedInMs: 2000,
      leadMs: 1800,
      label: "Top of the hour → a — a",
    });
    expect(p.elements[1]).toMatchObject({ kind: "song" });
    expect(p.notes[0]).toMatchObject({
      element: 0,
      seq: 0,
      treatment: "break",
      clip: "0",
      clipMs: 30_000,
      bedInMs: 2000,
      leadMs: 1800,
    });
    expect(p.notes[0]?.fallback).toBeUndefined();
    expect(valid(p)).toBe(true);
    expect(
      SegmentLog.safeParse({ slots: [slot(0, "a", "break")], fallbacks: [], topOfHour: true }).success,
    ).toBe(true);
  });

  it("a bed of null is a dry break", () => {
    const p = build([slot(0, "a", "break")], [{ seq: 0, words: "words" }], [[0, { clipMs: 30_000 }]], {
      bed: null,
    });
    expect(p.elements[0]).toEqual({
      kind: "break",
      clip: url(0),
      bedInMs: undefined,
      leadMs: 0,
      label: "Break → a — a",
    });
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
      [slot(0, "a", "break")],
      [{ seq: 0, words: "words", leadLine: "lead" }],
      [[0, { clipMs: 30_000, leadMs: 1800 }]],
      { topOfHour: true },
    );
    expect(p.elements[0]).toMatchObject({ bedInMs: undefined, leadMs: 1800 });
    expect(p.notes[0]?.fallback).toEqual({ from: "bedIn", to: "start", reason: "no legal ID" });
  });

  it("a break with no words → a produced sweeper if there is one, else a segue", () => {
    const withSweeper = build([slot(0, "a", "break")], [], [], { sweepers: ["/sweepers/sweep-hits.mp3"] });
    expect(withSweeper.elements[0]).toEqual({
      kind: "break",
      clip: "/sweepers/sweep-hits.mp3",
      leadMs: 0,
      label: "Sweeper → a — a",
    });
    expect(withSweeper.notes[0]?.fallback).toEqual({ from: "break", to: "sweeper", reason: "no words" });
    const none = build([slot(0, "a", "break")], [], []);
    expect(none.elements).toEqual([{ kind: "song", track: rec("a") }]);
    expect(none.notes[0]?.fallback).toEqual({ from: "break", to: "segue", reason: "no words" });
  });

  it("a break whose clip failed, with no sweepers → a song-first segment, naming the error", () => {
    const p = build(
      [slot(0, "a", "break"), slot(1, "b", "segue"), slot(2, "c", "segue"), slot(3, "d", "segue")],
      [{ seq: 0, words: "w" }],
      [[0, { error: "elevenlabs 401" }]],
    );
    expect(p.elements.map((e) => e.kind)).toEqual(["song", "song", "song", "song"]);
    expect(p.elements[0]).toEqual({ kind: "song", track: rec("a") });
    expect(p.notes).toHaveLength(1);
    expect(p.notes[0]?.fallback).toEqual({
      from: "break",
      to: "segue",
      reason: "clip failed: elevenlabs 401",
    });
  });

  it("a segment of one break and three segues with no clips: four elements, one note", () => {
    const p = build(
      [slot(0, "a", "break"), slot(1, "b", "segue"), slot(2, "c", "segue"), slot(3, "d", "segue")],
      [],
      [],
    );
    expect(p.elements).toHaveLength(4);
    expect(p.elements.every((e) => e.kind === "song")).toBe(true);
    expect(p.notes).toHaveLength(1);
    expect(p.notes[0]).toMatchObject({
      element: 0,
      treatment: "break",
      fallback: { from: "break", to: "segue" },
    });
  });

  it("a talk-up lands the post when the card is sure and the clip fits", () => {
    const p = build([slot(0, "a", "talkup")], [{ seq: 0, words: "w" }], [[0, { clipMs: 5000 }]]);
    const at = 14_000 - 5000 - BEAT_MS;
    expect(p.elements[0]).toEqual({
      kind: "song",
      track: rec("a"),
      talk: { clip: url(0), over: "intro", atMs: at },
    });
    expect(p.notes[0]).toMatchObject({ treatment: "talkup", atMs: at, clip: "0" });
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

  it("a sweeper: voiced with words, produced (round-robin) without, a segue when neither", () => {
    const voiced = build(
      [slot(0, "a", "sweeper")],
      [{ seq: 0, words: "Claude Radio!" }],
      [[0, { clipMs: 1500 }]],
    );
    expect(voiced.elements[0]).toEqual({ kind: "break", clip: url(0), leadMs: 0, label: "Sweeper → a — a" });
    expect(voiced.notes[0]?.fallback).toBeUndefined();
    const produced = build(
      [slot(0, "a", "sweeper"), slot(1, "b", "sweeper"), slot(2, "c", "sweeper")],
      [],
      [],
      { sweepers: ["/sweepers/x.mp3", "/sweepers/y.mp3"] },
    );
    expect(
      produced.elements.filter((e) => e.kind === "break").map((e) => (e.kind === "break" ? e.clip : "")),
    ).toEqual(["/sweepers/x.mp3", "/sweepers/y.mp3", "/sweepers/x.mp3"]);
    expect(produced.notes.every((n) => n.fallback === undefined)).toBe(true);
    const none = build([slot(0, "a", "sweeper")], [], []);
    expect(none.elements).toEqual([{ kind: "song", track: rec("a") }]);
    expect(none.notes[0]?.fallback).toEqual({ from: "sweeper", to: "segue", reason: "no words" });
  });

  it("everything fallen back is still one song per record", () => {
    const slots = [
      slot(0, "a", "break"),
      slot(1, "b", "talkup"),
      slot(2, "c", "sweeper"),
      slot(3, "d", "segue"),
      slot(4, "e", "talkup"),
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
    expect(valid(p)).toBe(true);
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
      expect(clip).toBe(url(n.seq));
    }
  });
});
