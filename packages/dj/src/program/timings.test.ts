import { describe, expect, it } from "vitest";
import { type Alignment, textOf, timingsOf } from "./timings.ts";

/** One character per 100 ms: character i starts at i × 100 ms and ends 100 ms later. */
const align = (text: string): Alignment => ({
  characters: [...text],
  character_start_times_seconds: [...text].map((_, i) => i / 10),
  character_end_times_seconds: [...text].map((_, i) => (i + 1) / 10),
});

const line = { legalId: "WFAI", words: "hello there", leadLine: "here's Prince" };

describe("textOf", () => {
  it("joins the legal ID, the words and the lead line with single spaces", () => {
    expect(textOf(line)).toBe("WFAI hello there here's Prince");
    expect(textOf({ words: "hello" })).toBe("hello");
  });
});

describe("timingsOf", () => {
  it("reads the clip length, the bed-in and the lead at known offsets", () => {
    const text = textOf(line);
    expect(timingsOf(line, align(text))).toEqual({
      clipMs: text.length * 100,
      bedInMs: (line.legalId.length + 1) * 100,
      leadMs: line.leadLine.length * 100,
    });
    expect(timingsOf(line, align(text))).toMatchObject({ clipMs: 3000 });
  });
  it("no lead line → no leadMs; no legal ID → no bedInMs", () => {
    const l = { words: "hello there" };
    expect(timingsOf(l, align(textOf(l)))).toEqual({ clipMs: 1100 });
  });
  it("an empty alignment is an error", () => {
    expect(
      timingsOf(line, { characters: [], character_start_times_seconds: [], character_end_times_seconds: [] }),
    ).toEqual({
      error: "empty alignment",
    });
  });
  it("a start that runs backwards is not trusted", () => {
    const text = textOf(line);
    const al = align(text);
    al.character_start_times_seconds[5] = 0; // the bed-in character, earlier than its predecessor
    expect(timingsOf(line, al)).toEqual({ clipMs: 3000, leadMs: 1300 });
  });
});
