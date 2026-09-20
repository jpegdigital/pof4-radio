import { describe, expect, it } from "vitest";
import { ChatPrompt, ChoiceQuestion } from "./contract.ts";

describe("prompt contracts", () => {
  it("preserves rendered text exactly", () => {
    const prompt = { system: "Instructions.\n", brief: "  Show context.\n" };
    expect(ChatPrompt.parse(prompt)).toEqual(prompt);
  });
  it.each([
    { id: "missing system", value: { brief: "Context" } },
    { id: "blank instructions", value: { system: " ", brief: "Context" } },
    { id: "blank context", value: { system: "Instructions", brief: "\n" } },
    { id: "unexpected field", value: { system: "Instructions", brief: "Context", model: "x" } },
  ])("rejects $id", ({ value }) => {
    expect(ChatPrompt.safeParse(value).success).toBe(false);
  });
  it("preserves dynamic choice IDs", () => {
    const question = {
      type: "choice",
      instructions: "Choose one.",
      criteria: { "recording-42": "The recording", none: "No match" },
    };
    expect(ChoiceQuestion.parse(question)).toEqual(question);
  });
  it.each([
    { id: "empty menu", criteria: {} },
    { id: "blank option", criteria: { none: " " } },
    { id: "blank ID", criteria: { "": "No match" } },
  ])("rejects $id", ({ criteria }) => {
    expect(ChoiceQuestion.safeParse({ type: "choice", instructions: "Choose one.", criteria }).success).toBe(
      false,
    );
  });
});
