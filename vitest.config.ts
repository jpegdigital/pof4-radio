import { defineConfig } from "vitest/config";

// One Vitest for the workspace: tests sit next to the code as `*.test.ts`.
// Pure logic only (contracts, parsers, helpers) — anything that needs
// Postgres or a model is verified in prod, per CLAUDE.md.
export default defineConfig({
  test: {
    environment: "node",
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
  },
});
