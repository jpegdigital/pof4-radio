import { describe, expect, it } from "vitest";
import { SessionParams, SlotBody } from "./params";

/** Two bodies: creation takes the ask and the voice; the slot rung takes the browser's clock and, maybe, `again`. */

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

describe("SlotBody — the clock, and maybe another take", () => {
  it("clockMs alone is enough", () => {
    expect(SlotBody.parse({ clockMs: 31_000_000 })).toEqual({ clockMs: 31_000_000 });
  });

  it("again is optional and passes through", () => {
    expect(SlotBody.parse({ clockMs: 0, again: true })).toEqual({ clockMs: 0, again: true });
  });

  it.each<{ id: string; body: unknown }>([
    { id: "no clockMs", body: { again: true } },
    { id: "an empty body", body: {} },
    { id: "a clock past midnight", body: { clockMs: 86_400_001 } },
    { id: "a negative clock", body: { clockMs: -1 } },
    { id: "a fractional clock", body: { clockMs: 1.5 } },
    { id: "again that is not a boolean", body: { clockMs: 0, again: "yes" } },
    { id: "not an object", body: null },
  ])("rejects $id", ({ body }) => {
    expect(SlotBody.safeParse(body).success).toBe(false);
  });
});
