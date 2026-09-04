import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { numbered, Proposal, Written } from "./shapes";

/**
 * The grammar guarantees required keys and refuses unknown ones, but not an array's length — so
 * a call for N things asks for key1…keyN, every key required. These tests pin that at the real
 * boundary: the JSON schema the SDK sends, and the read-back into a list. Then the two shapes
 * the show is made of: what the proposer names, and what the writer returns for one slot.
 */

interface Sent {
  required: string[];
  properties: Record<string, { required?: string[]; additionalProperties?: boolean }>;
  additionalProperties: boolean;
}

describe("numbered — N required keys, no array to overrun", () => {
  it("song1..song3 plus whatever else is in the object, every key required, nothing extra allowed", () => {
    const sent = zodOutputFormat(z.object({ rationale: z.string(), ...numbered("song", 3, Proposal).shape }))
      .schema as unknown as Sent;
    expect(sent.required).toEqual(["rationale", "song1", "song2", "song3"]);
    expect(Object.keys(sent.properties)).toEqual(["rationale", "song1", "song2", "song3"]);
    expect(sent.additionalProperties).toBe(false);
  });

  it("a proposal is artist, title, why — and nothing else", () => {
    const sent = zodOutputFormat(z.object(numbered("x", 1, Proposal).shape)).schema as unknown as Sent;
    expect(sent.properties.x1?.required).toEqual(["artist", "title", "why"]);
    expect(sent.properties.x1?.additionalProperties).toBe(false);
  });
});

describe("numbered().list — the keys read back in order", () => {
  it("reads song1..song2 in order, ignoring anything else", () => {
    expect(
      numbered("song", 2, Proposal).list({
        song1: { artist: "A", title: "T", why: "w1" },
        song2: { artist: "B", title: "U", why: "w2" },
        song3: { artist: "C", title: "V", why: "w3" },
      }),
    ).toEqual([
      { artist: "A", title: "T", why: "w1" },
      { artist: "B", title: "U", why: "w2" },
    ]);
  });

  it("a missing key is an error, not a hole", () => {
    expect(() =>
      numbered("song", 2, Proposal).list({ song1: { artist: "a", title: "t", why: "w" } }),
    ).toThrow("song2");
  });
});

describe("Written — one slot as the writer returns it", () => {
  const sent = zodOutputFormat(Written).schema as unknown as Sent;

  it("is the pick, the chart, the copy and the timing — every key required, nothing else", () => {
    expect(sent.required).toEqual([
      "pick",
      "rampSec",
      "sure",
      "post",
      "outro",
      "outroSec",
      "energy",
      "tempo",
      "mood",
      "kind",
      "words",
      "leadLine",
      "treatment",
      "recordUnderSec",
      "voiceInSec",
    ]);
    expect(sent.additionalProperties).toBe(false);
  });

  const good = {
    pick: "123",
    rampSec: 12,
    sure: true,
    post: "the title line",
    outro: "fade",
    outroSec: 200,
    energy: 3,
    tempo: "mid",
    mood: "easy",
    kind: "talkup",
    words: "hi",
    leadLine: "",
    treatment: "why",
    recordUnderSec: 0,
    voiceInSec: 1.5,
  };

  it("parses a good answer", () => {
    expect(Written.parse(good)).toEqual(good);
  });

  it.each(["break", "talkup", "sweeper", "segue"])("kind %s parses", (kind) => {
    expect(Written.parse({ ...good, kind }).kind).toBe(kind);
  });

  it.each<{ id: string; over: object }>([
    { id: "a kind that is not one of the four", over: { kind: "jingle" } },
    { id: "energy past 5", over: { energy: 6 } },
    { id: "energy under 1", over: { energy: 0 } },
    { id: "a fractional energy", over: { energy: 3.5 } },
    { id: "a pick that is not a string", over: { pick: 123 } },
    { id: "an outro that is not cold or fade", over: { outro: "loop" } },
    { id: "a tempo that is not down, mid or up", over: { tempo: "fast" } },
    { id: "sure as a string", over: { sure: "yes" } },
  ])("rejects $id", ({ over }) => {
    expect(Written.safeParse({ ...good, ...over }).success).toBe(false);
  });
});
