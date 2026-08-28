// One ESLint config for the whole workspace (mirrors dreamweaver). `pnpm lint` runs it from the root.
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  globalIgnores([
    "**/node_modules/**",
    "**/.next/**",
    "**/out/**",
    "**/dist/**",
    "**/next-env.d.ts",
    "**/.claude/**",
  ]),
  {
    files: ["**/*.{ts,tsx,mts}"],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: true }],
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true },
      ],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx,mts}"],
    extends: [nextVitals, nextTs],
    settings: { next: { rootDir: "apps/web/" } },
  },
  { files: ["**/*.{js,mjs,cjs}"], extends: [tseslint.configs.disableTypeChecked] },
]);
