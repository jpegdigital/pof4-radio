import { describe, expect, it } from "vitest";
import { z } from "zod";
import { compileTemplate, template } from "./template.ts";

describe("strict prompt templates", () => {
  const Variables = z.strictObject({ name: z.string(), opening: z.boolean() });
  it("renders conditions and inserts plain text only once", () => {
    const render = compileTemplate(
      "test",
      "{{#if opening}}Hello {{name}}{{else}}Continue {{name}}{{/if}}",
      Variables,
    );
    expect(render({ name: "A & B <live> {{opening}}", opening: true })).toBe(
      "Hello A & B <live> {{opening}}",
    );
    expect(render({ name: "Host", opening: false })).toBe("Continue Host");
  });
  it.each([
    { name: "missing variable", value: { opening: true } },
    { name: "wrong variable type", value: { name: "Host", opening: "yes" } },
    { name: "unexpected variable", value: { name: "Host", opening: false, extra: 1 } },
  ])("rejects $name with the template name", ({ value }) => {
    const render = compileTemplate("test", "{{name}}", Variables);
    expect(() => render(value as z.infer<typeof Variables>)).toThrow(/test/);
  });
  it.each(["{{typo}}", "{{#if opening}}{{name}}{{else}}{{typo}}{{/if}}", "{{#if typo}}hidden{{/if}}"])(
    "rejects undeclared references before rendering: %s",
    (source) => {
      expect(() => compileTemplate("test", source, Variables)).toThrow(/test.*typo/);
    },
  );
  it("rejects malformed syntax", () => {
    expect(() => compileTemplate("broken", "{{#if opening}}", Variables)).toThrow(/broken/);
  });
  it("fails for missing files instead of falling back", () => {
    expect(() => template("missing-template", z.strictObject({}))).toThrow(/missing-template/);
  });
  it("rejects blank output", () => {
    const render = compileTemplate("empty", "{{name}}", Variables);
    expect(() => render({ name: " ", opening: false })).toThrow(/empty/);
  });
});
