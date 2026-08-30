import { describe, expect, it } from "vitest";
import { choicesOf, composeTool, picksOf, proposeTool } from "./tools";

/**
 * Strict tool use enforces `required` properties but not array lengths — so counts are enforced
 * by shape: song1…songN / slot1…slotN, every slot required. These tests pin that shape.
 */

describe("proposeTool — N required song slots, no array to overrun", () => {
  it("proposeTool(3) requires rationale and exactly song1..song3", () => {
    const schema = proposeTool(3).input_schema as unknown as {
      required: string[];
      properties: Record<string, unknown>;
      additionalProperties: boolean;
    };
    expect(schema.required).toEqual(["rationale", "song1", "song2", "song3"]);
    expect(Object.keys(schema.properties)).toEqual(["rationale", "song1", "song2", "song3"]);
    expect(schema.additionalProperties).toBe(false);
  });

  it("each song slot requires artist, title, why and nothing else", () => {
    const schema = proposeTool(1).input_schema as unknown as {
      properties: { song1: { required: string[]; additionalProperties: boolean } };
    };
    expect(schema.properties.song1.required).toEqual(["artist", "title", "why"]);
    expect(schema.properties.song1.additionalProperties).toBe(false);
  });

  it("picksOf reads the slots back in order", () => {
    const picks = picksOf(
      {
        rationale: "r",
        song1: { artist: "A", title: "T", why: "w1" },
        song2: { artist: "B", title: "U", why: "w2" },
      },
      2,
    );
    expect(picks).toEqual([
      { artist: "A", title: "T", why: "w1" },
      { artist: "B", title: "U", why: "w2" },
    ]);
  });
});

describe("composeTool — N required slots, each an id plus a why written for this playlist", () => {
  it("composeTool(2) requires rationale and exactly slot1..slot2", () => {
    const schema = composeTool(2).input_schema as unknown as {
      required: string[];
      properties: Record<string, unknown>;
      additionalProperties: boolean;
    };
    expect(schema.required).toEqual(["rationale", "slot1", "slot2"]);
    expect(Object.keys(schema.properties)).toEqual(["rationale", "slot1", "slot2"]);
    expect(schema.additionalProperties).toBe(false);
  });

  it("each slot requires id and why and nothing else", () => {
    const schema = composeTool(1).input_schema as unknown as {
      properties: { slot1: { required: string[]; additionalProperties: boolean } };
    };
    expect(schema.properties.slot1.required).toEqual(["id", "why"]);
    expect(schema.properties.slot1.additionalProperties).toBe(false);
  });

  it("choicesOf reads slots in order and drops the empty-id ones", () => {
    const choices = choicesOf(
      {
        rationale: "r",
        slot1: { id: "a", why: "opens it" },
        slot2: { id: "", why: "" },
        slot3: { id: "b", why: "closes it" },
      },
      3,
    );
    expect(choices).toEqual([
      { id: "a", why: "opens it" },
      { id: "b", why: "closes it" },
    ]);
  });

  it("choicesOf ignores anything past n", () => {
    expect(
      choicesOf({ rationale: "r", slot1: { id: "a", why: "w" }, slot2: { id: "b", why: "w" } }, 1),
    ).toEqual([{ id: "a", why: "w" }]);
  });
});
