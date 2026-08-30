import { describe, expect, it } from "vitest";
import { Card, Line, Record, SegmentView, Skeleton } from "./shapes.ts";

const record = {
  id: "abc",
  uri: "spotify:track:abc",
  name: "Hungry Like the Wolf",
  artists: ["Duran Duran"],
  album: "Rio",
  image: null,
  durationMs: 221000,
  pick: 0,
  why: "the glossy opener",
};

const card = {
  id: "abc",
  name: "Hungry Like the Wolf",
  artists: ["Duran Duran"],
  introMs: 14000,
  sure: true,
  post: "In touch with the ground",
  outro: "fade",
  outroMs: 205000,
  energy: 4,
  tempo: "up",
  mood: "hunting, glossy",
  notes: ["1982", "the Rio single"],
  thinking: "…",
  model: "claude-opus-5",
};

describe("Line", () => {
  it("accepts a line for every treatment", () => {
    const lines = [
      {
        seq: 0,
        treatment: "break",
        legalId: "WFAI, Dallas.",
        words: "Good evening.",
        leadLine: "Here's Prince.",
      },
      { seq: 1, treatment: "talkup", words: "Fourteen seconds of Duran Duran." },
      { seq: 2, treatment: "sweeper", words: "Claude Radio!" },
      { seq: 3, treatment: "segue", words: "" },
    ];
    for (const l of lines) expect(Line.safeParse(l).success).toBe(true);
  });
  it("refuses an unknown treatment", () => {
    const bad = Line.safeParse({ seq: 1, treatment: "jingle", words: "x" });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]?.path).toEqual(["treatment"]);
  });
});

describe("Card / Record / Skeleton", () => {
  it("narrows enums and ranges", () => {
    expect(Card.safeParse(card).success).toBe(true);
    expect(Card.safeParse({ ...card, introMs: -1 }).success).toBe(false);
    expect(Card.safeParse({ ...card, energy: 6 }).success).toBe(false);
    expect(Card.safeParse({ ...card, outro: "long" }).success).toBe(false);
    expect(Card.safeParse({ ...card, tempo: "fast" }).success).toBe(false);
  });
  it("a record needs a track uri", () => {
    expect(Record.safeParse(record).success).toBe(true);
    expect(Record.safeParse({ ...record, uri: "abc" }).success).toBe(false);
  });
  it("a skeleton's records are unique by id", () => {
    const ok = { rationale: "why", records: [record], breaks: [0], consumed: 0, plannedAt: "t" };
    expect(Skeleton.safeParse(ok).success).toBe(true);
    expect(Skeleton.safeParse({ ...ok, records: [record, record] }).success).toBe(false);
  });
});

describe("SegmentView", () => {
  const view = {
    id: "seg-1",
    seq: 1,
    prompt: "Saturday night 80s",
    complete: true,
    records: [record],
    lines: [{ seq: 0, treatment: "break", legalId: "WFAI, Dallas.", words: "…", leadLine: "Here it is." }],
    log: {
      slots: [{ seq: 0, id: "abc", intro: "break", why: "the opening" }],
      fallbacks: [],
      topOfHour: true,
    },
    cards: {
      abc: { introMs: 14000, sure: true, post: "In touch", outro: "fade", energy: 4, notes: ["1982"] },
    },
    dropped: [{ pick: 3, reason: "refusal" }],
    elements: [
      {
        kind: "break",
        clip: "/api/clip/seg-1/0",
        bed: "/bed.mp3",
        bedInMs: 2100,
        leadMs: 1800,
        label: "Top",
      },
      { kind: "song", track: record },
    ],
    notes: [{ element: 0, seq: 0, treatment: "break", words: "…", clip: "0", clipMs: 31200, leadMs: 1800 }],
  };
  it("round-trips", () => {
    const parsed = SegmentView.parse(view);
    expect(parsed).toEqual(view);
    expect(SegmentView.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(view);
  });
  it("a segment just opened has empty lines, slots, elements and notes", () => {
    const opened = {
      ...view,
      complete: false,
      lines: [],
      log: { ...view.log, slots: [] },
      elements: [],
      notes: [],
    };
    expect(SegmentView.safeParse(opened).success).toBe(true);
    expect(SegmentView.safeParse({ ...view, elements: null }).success).toBe(false);
  });
  it("refuses a bad element, a duplicate record, a bad treatment", () => {
    expect(SegmentView.safeParse({ ...view, elements: [{ kind: "ad" }] }).success).toBe(false);
    expect(SegmentView.safeParse({ ...view, records: [record, record] }).success).toBe(false);
    expect(
      SegmentView.safeParse({ ...view, notes: [{ ...view.notes[0], treatment: "jingle" }] }).success,
    ).toBe(false);
  });
});
