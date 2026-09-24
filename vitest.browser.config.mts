import path from "node:path";
import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "apps/web/src") } },
  test: {
    include: ["apps/**/*.browser.test.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [
        { browser: "chromium" },
        {
          browser: "webkit",
          // Playwright's Windows WebKit build omits Web Audio. Linux CI runs the full suite.
          include:
            process.platform === "win32"
              ? ["apps/**/use-scrub.browser.test.ts"]
              : ["apps/**/*.browser.test.ts"],
        },
      ],
    },
  },
});
