import { describe, expect, it } from "vitest";
import { type Hit, type SlotRow, slotDoc, statusOf } from "./doc";

/**
 * The slot on the wire: status from presence, the pick's tags from the slot's own hits, `held`
 * from the set the caller read, and nothing the browser has no use for — the hits once picked,
 * the writer's thinking, the clock the write was made at.
 */

const hits: Hit[] = [
  {
    id: "a",
    title: "Dreams",
    artists: ["Fleetwood Mac"],
    album: "Rumours",
    image: "https://img/a",
    durationMs: 257_000,
  },
  {
    id: "b",
    title: "Dreams (Live)",
    artists: ["Fleetwood Mac"],
    album: "The Dance",
    image: null,
    durationMs: 300_000,
  },
];

const proposed: SlotRow = {
  seq: 2,
  title: "Dreams",
  artist: "Fleetwood Mac",
  why: "the one everybody knows",
  hits,
  qobuz_id: null,
  clock_ms: null,
  ramp_ms: null,
  sure: null,
  post: null,
  outro: null,
  outro_ms: null,
  energy: null,
  tempo: null,
  mood: null,
  kind: null,
  words: null,
  lead_line: null,
  legal_id: null,
  treatment: null,
  fallback: null,
  record_under_ms: null,
  voice_in_ms: null,
  clip_key: null,
  voiced_at: null,
};

const written: SlotRow = {
  ...proposed,
  qobuz_id: "b",
  clock_ms: 31_000_000,
  ramp_ms: 12_000,
  sure: true,
  post: "the title line",
  outro: "fade",
  outro_ms: 280_000,
  energy: 3,
  tempo: "mid",
  mood: "easy",
  kind: "talkup",
  words: "hi there",
  lead_line: null,
  legal_id: null,
  treatment: "because",
  fallback: null,
  record_under_ms: null,
  voice_in_ms: 1500,
};

const voiced: SlotRow = { ...written, clip_key: "sessions/s/2.mp3", voiced_at: new Date() };

describe("statusOf — from what is present", () => {
  it.each<{ id: string; row: SlotRow; want: string }>([
    { id: "no pick → proposed", row: proposed, want: "proposed" },
    { id: "a pick, not voiced → written", row: written, want: "written" },
    { id: "voiced_at set → voiced", row: voiced, want: "voiced" },
    { id: "voiced with no clip (a segue) → voiced", row: { ...voiced, clip_key: null }, want: "voiced" },
  ])("$id", ({ row, want }) => {
    expect(statusOf(row)).toBe(want);
  });
});

describe("slotDoc — the proposal only, while proposed", () => {
  it("carries seq, status, title, artist, why and voiced:false, nothing else", () => {
    expect(slotDoc(proposed, new Set())).toEqual({
      seq: 2,
      status: "proposed",
      title: "Dreams",
      artist: "Fleetwood Mac",
      why: "the one everybody knows",
      voiced: false,
    });
  });
});

describe("slotDoc — written and after", () => {
  it("the pick is the hit whose id is qobuz_id; held from the set; the chart, the copy, the timing", () => {
    const d = slotDoc(written, new Set(["b"]));
    expect(d.status).toBe("written");
    expect(d.pick).toEqual(hits[1]);
    expect(d.held).toBe(true);
    expect(d.chart).toEqual({
      rampMs: 12_000,
      sure: true,
      post: "the title line",
      outro: "fade",
      outroMs: 280_000,
      energy: 3,
      tempo: "mid",
      mood: "easy",
    });
    expect(d).toMatchObject({
      kind: "talkup",
      words: "hi there",
      treatment: "because",
      voiceInMs: 1500,
      voiced: false,
    });
    expect(d).not.toHaveProperty("leadLine");
    expect(d).not.toHaveProperty("legalId");
    expect(d).not.toHaveProperty("fallback");
    expect(d).not.toHaveProperty("recordUnderMs");
    expect(d).not.toHaveProperty("clipKey");
  });

  it("not held when the set lacks the pick", () => {
    expect(slotDoc(written, new Set(["a"])).held).toBe(false);
  });

  it("never carries the hits, the thinking or the clock", () => {
    const d = slotDoc(voiced, new Set()) as unknown as Record<string, unknown>;
    expect(d).not.toHaveProperty("hits");
    expect(d).not.toHaveProperty("thinking");
    expect(d).not.toHaveProperty("clock_ms");
    expect(d).not.toHaveProperty("clockMs");
  });

  it("a no-chart segue (the writer gave nothing) has no chart key", () => {
    const d = slotDoc(
      {
        ...voiced,
        ramp_ms: null,
        sure: null,
        post: null,
        outro: null,
        outro_ms: null,
        energy: null,
        tempo: null,
        mood: null,
        kind: "segue",
        words: null,
        clip_key: null,
        treatment: "the writer refused twice",
      },
      new Set(),
    );
    expect(d).not.toHaveProperty("chart");
    expect(d).toMatchObject({
      status: "voiced",
      kind: "segue",
      voiced: true,
      treatment: "the writer refused twice",
    });
    expect(d).not.toHaveProperty("clipKey");
    expect(d).not.toHaveProperty("words");
  });

  it("a voiced break carries the lead line, the legal ID, the fallback, the timing and the clip key", () => {
    const d = slotDoc(
      {
        ...voiced,
        seq: 1,
        kind: "break",
        lead_line: "here it is",
        legal_id: "WXYZ, Dallas.",
        fallback: { from: "talkup", to: "break", reason: "the clock" },
        record_under_ms: 3000,
        voice_in_ms: null,
        clip_key: "sessions/s/1.mp3",
      },
      new Set(["b"]),
    );
    expect(d).toMatchObject({
      seq: 1,
      status: "voiced",
      kind: "break",
      leadLine: "here it is",
      legalId: "WXYZ, Dallas.",
      fallback: { from: "talkup", to: "break", reason: "the clock" },
      recordUnderMs: 3000,
      voiced: true,
      clipKey: "sessions/s/1.mp3",
    });
    expect(d).not.toHaveProperty("voiceInMs");
  });

  it("a pick outside the hits is a fault, not a silent hole", () => {
    expect(() => slotDoc({ ...written, qobuz_id: "ghost" }, new Set())).toThrow(/ghost/);
  });
});
