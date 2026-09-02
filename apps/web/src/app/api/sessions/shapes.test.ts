import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Choice, numbered, Pick, Slot } from "./shapes";

/**
 * The grammar guarantees required keys and refuses unknown ones, but not an array's length — so
 * a call for N things asks for key1…keyN, every key required. These tests pin that at the real
 * boundary: the JSON schema the SDK sends, and the read-back into a list.
 */

interface Sent {
  required: string[];
  properties: Record<string, { required?: string[]; additionalProperties?: boolean }>;
  additionalProperties: boolean;
}

describe("numbered — N required keys, no array to overrun", () => {
  it("song1..song3 plus whatever else is in the object, every key required, nothing extra allowed", () => {
    const sent = zodOutputFormat(z.object({ rationale: z.string(), ...numbered("song", 3, Pick).shape }))
      .schema as unknown as Sent;
    expect(sent.required).toEqual(["rationale", "song1", "song2", "song3"]);
    expect(Object.keys(sent.properties)).toEqual(["rationale", "song1", "song2", "song3"]);
    expect(sent.additionalProperties).toBe(false);
  });

  it.each([
    { id: "a pick is artist, title, why", item: Pick, want: ["artist", "title", "why"] },
    { id: "a choice is id, why", item: Choice, want: ["id", "why"] },
    {
      id: "a slot is kind, words, leadLine, the two numbers, why",
      item: Slot,
      want: ["kind", "words", "leadLine", "recordUnderSec", "voiceInSec", "why"],
    },
  ])("$id — and nothing else", ({ item, want }) => {
    const sent = zodOutputFormat(z.object(numbered("x", 1, item).shape)).schema as unknown as Sent;
    expect(sent.properties.x1?.required).toEqual(want);
    expect(sent.properties.x1?.additionalProperties).toBe(false);
  });
});

describe("numbered().list — the keys read back in order", () => {
  it("reads song1..song2 in order, ignoring anything else", () => {
    expect(
      numbered("song", 2, Pick).list({
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
    expect(() => numbered("slot", 2, Choice).list({ slot1: { id: "a", why: "w" } })).toThrow("slot2");
  });
});

describe("Slot — the writer's kinds", () => {
  it.each(["break", "talkup", "sweeper", "segue"])("%s parses", (kind) => {
    expect(
      Slot.parse({ kind, words: "", leadLine: "", recordUnderSec: 0, voiceInSec: 0, why: "w" }).kind,
    ).toBe(kind);
  });

  it("anything else does not", () => {
    expect(() =>
      Slot.parse({ kind: "jingle", words: "", leadLine: "", recordUnderSec: 0, voiceInSec: 0, why: "w" }),
    ).toThrow();
  });
});
