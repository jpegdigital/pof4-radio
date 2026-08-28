/**
 * `pnpm db:plan` / `pnpm db:apply` — the declarative schema workflow.
 *
 * `schema/*.sql` is the database as it should be. pg-delta loads it into a throwaway
 * shadow database on the same Postgres server, diffs that against the real database
 * (DATABASE_URL), and either prints the SQL it would run (plan) or runs it (apply).
 * There is one database, so there are no migration files: the diff *is* the migration.
 *
 *   pnpm db:plan                 # review the SQL
 *   pnpm db:apply                # run it
 *   pnpm db:apply --allow-data-loss       # you read the plan and a drop is intended
 *   pnpm db:plan  --accept-rename public.options.title=public.options.name
 *
 * Renames are off by default so a rename shows up as drop+add and is refused
 * (data loss) until you say so explicitly — the safe default when an AI writes the SQL.
 * Anything after plan|apply is passed straight to `pgdelta schema apply`.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mode = process.argv[2];
if (mode !== "plan" && mode !== "apply") {
  console.error("usage: schema.ts plan|apply [pgdelta flags…]");
  process.exit(2);
}
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (run through `op run`, see .env.op)");

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, "..");
// The CLI entry lives next to the library entry: dist/index.js → dist/cli/main.js.
const cli = path.join(
  path.dirname(createRequire(import.meta.url).resolve("@supabase/pg-delta")),
  "cli/main.js",
);

const args = [
  cli,
  "schema",
  "apply",
  "--dir",
  path.join(pkg, "schema"),
  "--target",
  url,
  "--profile",
  path.join(pkg, "pgdelta.profile.json"),
  "--renames",
  "off",
  ...(mode === "plan" ? ["--dry-run"] : ["--verbose"]),
  ...process.argv.slice(3).filter((a) => a !== "--"), // pnpm forwards the separator
];

const result = spawnSync(process.execPath, args, { stdio: "inherit" });
process.exit(result.status ?? 1);
