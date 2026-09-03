import path from "node:path";
import { defineConfig } from "vitest/config";

// One Vitest for the workspace: tests sit next to the code as `*.test.ts`.
// Pure logic only (contracts, parsers, helpers) — anything that needs
// Postgres or a model is verified in prod, per CLAUDE.md.
export default defineConfig({
  resolve: {
    // The web app's `@/` (apps/web/tsconfig.json `paths`), so a test can import a module that uses it.
    alias: { "@": path.resolve(import.meta.dirname, "apps/web/src") },
  },
  test: {
    environment: "node",
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
  },
});
