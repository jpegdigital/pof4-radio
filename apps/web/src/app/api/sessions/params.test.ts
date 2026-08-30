import { describe, expect, it } from "vitest";
import { DEFAULTS, SessionParams } from "./params";

const body = (over: object = {}) => ({ prompt: "rainy night drive", voiceId: "v1", ...over });

describe("SessionParams — the tunables, with defaults", () => {
  it("prompt and voiceId alone → every knob at its default", () => {
    const p = SessionParams.parse(body());
    expect(p).toMatchObject({ propose: 12, candidates: 5, playlist: 8, min: 4 });
    expect(p).toMatchObject(DEFAULTS);
  });

  it("explicit knobs override the defaults", () => {
    const p = SessionParams.parse(body({ propose: 20, candidates: 3, playlist: 10, min: 6 }));
    expect(p).toMatchObject({ propose: 20, candidates: 3, playlist: 10, min: 6 });
  });

  it.each<{ id: string; over: object }>([
    { id: "no prompt", over: { prompt: "" } },
    { id: "no voiceId", over: { voiceId: "" } },
    { id: "propose zero", over: { propose: 0 } },
    { id: "propose absurd", over: { propose: 999 } },
    { id: "candidates zero", over: { candidates: 0 } },
    { id: "candidates beyond the search cap", over: { candidates: 11 } },
    { id: "playlist zero", over: { playlist: 0 } },
    { id: "min zero", over: { min: 0 } },
    { id: "fractional knob", over: { playlist: 7.5 } },
    { id: "min above playlist", over: { playlist: 8, min: 9 } },
  ])("rejects $id", ({ over }) => {
    expect(SessionParams.safeParse(body(over)).success).toBe(false);
  });
});
