import * as fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { compileTemplate, jsonPrompt, previewTemplate, template } from "./template.ts";

vi.mock("node:fs", { spy: true });
const actualFs = await vi.importActual<typeof fs>("node:fs");

describe("structured Jev prompt files", () => {
  const schema = z.strictObject({ instructions: z.string().min(1) });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.readFileSync).mockReset().mockImplementation(actualFs.readFileSync);
    vi.unstubAllEnvs();
  });

  it("reloads edited JSON in development and previews literal content", () => {
    vi.stubEnv("NODE_ENV", "development");
    const read = vi.spyOn(fs, "readFileSync").mockClear().mockReturnValue('{"instructions":"First"}');
    const load = jsonPrompt("test-questions", schema);
    expect(load()).toEqual({ instructions: "First" });
    read.mockReturnValue('{"instructions":"Choose {{literal}}"}');
    expect(JSON.parse(previewTemplate("test-questions", {}))).toEqual({ instructions: "Choose {{literal}}" });
    read.mockReturnValue('{"instructions":"Changed","typo":true}');
    expect(load).toThrow(/test-questions\.jev\.json/);
  });

  it("caches validated definitions in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const read = vi.spyOn(fs, "readFileSync").mockReturnValue('{"instructions":"First"}');
    const load = jsonPrompt("test-cached", schema);
    read.mockReturnValue("broken");
    expect(load()).toEqual({ instructions: "First" });
    expect(read.mock.calls.filter(([path]) => String(path).endsWith("test-cached.jev.json"))).toHaveLength(1);
  });

  it.each(["broken", '{"instructions":1}', '{"instructions":""}'])(
    "rejects invalid JSON definitions with the filename: %s",
    (source) => {
      vi.spyOn(fs, "readFileSync").mockReturnValue(source);
      expect(() => jsonPrompt("test-invalid", schema)).toThrow(/test-invalid\.jev\.json/);
    },
  );
});

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
