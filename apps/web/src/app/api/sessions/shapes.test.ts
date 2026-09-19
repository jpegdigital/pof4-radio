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

describe("Written — prose only", () => {
  const sent = zodOutputFormat(Written).schema as unknown as Sent;
  it("gives Claude only words and the lead line", () => {
    expect(sent.required).toEqual(["words", "leadLine"]);
    expect(sent.additionalProperties).toBe(false);
    expect(Written.parse({ words: "Hello", leadLine: "Here it is." })).toEqual({
      words: "Hello",
      leadLine: "Here it is.",
    });
  });
  it.each(["pick", "kind", "rampSec", "voiceInSec", "recordUnderSec", "energy"])(
    "rejects a writer deciding %s",
    (key) => {
      expect(Written.safeParse({ words: "Hi", leadLine: "", [key]: 1 }).success).toBe(false);
    },
  );
});
