import { describe, expect, it } from "vitest";
import { Card, Log, Picks, Program, Request, Script } from "./shapes";

const record = {
  id: "abc",
  uri: "spotify:track:abc",
  name: "Hungry Like the Wolf",
  artists: ["Duran Duran"],
  album: "Rio",
  image: null,
  durationMs: 221000,
  pick: 0,
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
  enrichedAt: "2026-08-30T20:12:00Z",
  model: "claude-opus-5",
};

describe("shapes", () => {
  it("request", () => {
    const ok = {
      request: "Saturday night 80s",
      station: { onAir: "56.6, Claude Radio", calls: "WFAI", city: "Dallas" },
      dj: "Marcus",
      startMs: 74580000,
      count: 12,
    };
    expect(Request.safeParse(ok).success).toBe(true);
    expect(Request.safeParse({ ...ok, count: 30 }).success).toBe(false);
  });

  it("picks", () => {
    const ok = {
      rationale: "why",
      picks: [{ artist: "Duran Duran", title: "Hungry Like the Wolf", why: "…" }],
      records: [record],
      dropped: [{ pick: 3, reason: "no track" }],
    };
    expect(Picks.safeParse(ok).success).toBe(true);
    expect(Picks.safeParse({ ...ok, records: [record, record] }).success).toBe(false);
    expect(Picks.safeParse({ ...ok, records: [{ ...record, uri: "abc" }] }).success).toBe(false);
  });

  it("card (outroMs > durationMs is the enrich stage's clamp, not the schema's)", () => {
    expect(Card.safeParse(card).success).toBe(true);
    expect(Card.safeParse({ ...card, energy: 6 }).success).toBe(false);
    expect(Card.safeParse({ ...card, outro: "long" }).success).toBe(false);
    expect(Card.safeParse({ ...card, tempo: "fast" }).success).toBe(false);
  });

  it("log", () => {
    const ok = {
      slots: [{ seq: 0, id: "abc", intro: "break", topOfHour: false, why: "cold open" }],
      fallbacks: [{ seq: 1, from: "talkup", to: "segue", reason: "card not sure" }],
      crossesHour: false,
      hourAtSeq: null,
    };
    expect(Log.safeParse(ok).success).toBe(true);
    const bad = Log.safeParse({ ...ok, slots: [{ ...ok.slots[0], intro: "talkupx" }] });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]?.path).toEqual(["slots", 0, "intro"]);
  });

  it("script", () => {
    const ok = {
      lines: [
        { seq: 0, legalId: "", words: "…", leadLine: "Right now — Duran Duran." },
        { seq: 1, words: "Fourteen seconds of Duran Duran." },
      ],
    };
    expect(Script.safeParse(ok).success).toBe(true);
    expect(Script.safeParse({ lines: [{ seq: 0 }] }).success).toBe(false);
  });

  it("program takes the reducer's elements structurally", () => {
    const ok = {
      station: "WFAI",
      dj: "Marcus",
      voiceId: "v",
      startMs: 74580000,
      elements: [
        { kind: "break", clip: "slot-0", bed: "bed", leadMs: 2100, label: "Break" },
        { kind: "song", track: record },
      ],
      notes: [
        { element: 0, seq: 0, treatment: "break", words: "…", clip: "slot-0", clipMs: 31200, leadMs: 2100 },
      ],
      madeAt: "2026-08-30T20:20:00Z",
    };
    expect(Program.safeParse(ok).success).toBe(true);
    expect(Program.safeParse({ ...ok, elements: [{ kind: "ad" }] }).success).toBe(false);
    expect(Program.safeParse({ ...ok, notes: [{ ...ok.notes[0], treatment: "jingle" }] }).success).toBe(
      false,
    );
  });
});
