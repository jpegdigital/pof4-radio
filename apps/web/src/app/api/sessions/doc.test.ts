import { describe, expect, it } from "vitest";
import { slotDoc, statusOf } from "./doc";

describe("statusOf — a segment's stage from what is present", () => {
  it.each([
    { id: "open: no tracks", tracks: null, slots: [], want: "open" },
    { id: "playlisted: tracks, no slots", tracks: [{}], slots: [], want: "playlisted" },
    {
      id: "programmed: a slot still unvoiced",
      tracks: [{}],
      slots: [{ voiced_at: new Date() }, { voiced_at: null }],
      want: "programmed",
    },
    { id: "voiced: every slot stamped", tracks: [{}], slots: [{ voiced_at: new Date() }], want: "voiced" },
  ])("$id", ({ tracks, slots, want }) => {
    expect(statusOf(tracks, slots)).toBe(want);
  });
});

describe("slotDoc — absent columns are absent keys", () => {
  const row = {
    seq: 2,
    track_id: "t",
    kind: "talkup",
    words: "hi",
    lead_line: null,
    legal_id: null,
    why: "w",
    fallback: null,
    record_under_ms: null,
    voice_in_ms: null,
    clip_key: null,
    voiced_at: null,
    intro_ms: null,
  };

  it("an unvoiced talk-up carries its words and voiced: false, no null keys", () => {
    expect(slotDoc(row)).toEqual({
      seq: 2,
      trackId: "t",
      kind: "talkup",
      words: "hi",
      why: "w",
      voiced: false,
    });
  });

  it("a voiced break carries its numbers and clip key", () => {
    expect(
      slotDoc({
        ...row,
        seq: 1,
        kind: "break",
        lead_line: "l",
        legal_id: "id",
        record_under_ms: 3000,
        intro_ms: 9000,
        clip_key: "k",
        voiced_at: new Date(),
        fallback: { from: "break", to: "break", reason: "r" },
      }),
    ).toEqual({
      seq: 1,
      trackId: "t",
      kind: "break",
      words: "hi",
      leadLine: "l",
      legalId: "id",
      why: "w",
      fallback: { from: "break", to: "break", reason: "r" },
      recordUnderMs: 3000,
      introMs: 9000,
      voiced: true,
      clipKey: "k",
    });
  });
});
