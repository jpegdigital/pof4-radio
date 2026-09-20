import { readFile } from "node:fs/promises";
import "../src/lib/prompts/index.ts";
import { previewTemplate, templateNames } from "../src/lib/prompts/template.ts";

const [name, inputFile, ...extra] = process.argv.slice(2);
if (!name || name === "--list") {
  console.log(templateNames().join("\n"));
} else {
  if (extra.length) throw new Error("Usage: pnpm prompt:preview <name> [variables.json]");
  const input: unknown = inputFile ? JSON.parse(await readFile(inputFile, "utf8")) : {};
  console.log(previewTemplate(name, input));
}
