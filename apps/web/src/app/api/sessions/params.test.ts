import { describe, expect, it } from "vitest";
import { DEFAULTS, Knobs, SessionParams } from "./params";

/**
 * Two schemas, one each side of the split: creation takes only the ask and the voice; a
 * production rung takes a partial Knobs body where anything not sent lands on the default.
 */

describe("SessionParams — the ask and the voice, nothing else", () => {
  it("accepts a prompt and a voiceId, trimmed", () => {
    expect(SessionParams.parse({ prompt: "  rainy night drive ", voiceId: " v1 " })).toEqual({
      prompt: "rainy night drive",
      voiceId: "v1",
    });
  });

  it.each<{ id: string; body: object }>([
    { id: "no prompt", body: { prompt: "", voiceId: "v1" } },
    { id: "no voiceId", body: { prompt: "x", voiceId: "" } },
    { id: "prompt over 500 chars", body: { prompt: "x".repeat(501), voiceId: "v1" } },
  ])("rejects $id", ({ body }) => {
    expect(SessionParams.safeParse(body).success).toBe(false);
  });
});

describe("Knobs — the tunables, with defaults", () => {
  it("an empty body → every knob at its default", () => {
    expect(Knobs.parse({})).toEqual(DEFAULTS);
  });

  it("explicit knobs override the defaults", () => {
    const p = Knobs.parse({ propose: 20, candidates: 3, playlist: 10, min: 6 });
    expect(p).toEqual({ propose: 20, candidates: 3, playlist: 10, min: 6 });
  });

  it.each<{ id: string; over: object }>([
    { id: "propose zero", over: { propose: 0 } },
    { id: "propose absurd", over: { propose: 999 } },
    { id: "candidates zero", over: { candidates: 0 } },
    { id: "candidates beyond the search cap", over: { candidates: 11 } },
    { id: "playlist zero", over: { playlist: 0 } },
    { id: "min zero", over: { min: 0 } },
    { id: "fractional knob", over: { playlist: 7.5 } },
    { id: "min above playlist", over: { playlist: 8, min: 9 } },
  ])("rejects $id", ({ over }) => {
    expect(Knobs.safeParse(over).success).toBe(false);
  });
});
