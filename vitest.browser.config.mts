import path from "node:path";
import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "apps/web/src"),
      // Keep workspace components and icon dependencies on the same React instance.
      react: path.resolve(import.meta.dirname, "apps/web/node_modules/react"),
      "react-dom": path.resolve(import.meta.dirname, "apps/web/node_modules/react-dom"),
      "lucide-react": path.resolve(import.meta.dirname, "apps/web/node_modules/lucide-react"),
    },
  },
  optimizeDeps: { include: ["react", "react-dom/client", "react/jsx-dev-runtime", "lucide-react"] },
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
              ? [
                  "apps/**/use-scrub.browser.test.ts",
                  "apps/**/remote-navigation.browser.test.ts",
                  "apps/**/player.browser.test.ts",
                ]
              : ["apps/**/*.browser.test.ts"],
        },
      ],
    },
  },
});
