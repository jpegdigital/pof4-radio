/** Manual billed editorial smoke: op run --env-file=.env.op -- node apps/web/scripts/headlines-editor-smoke.mts */
import Anthropic from "@anthropic-ai/sdk";
import { NEWS_DEFAULTS } from "../src/lib/news.ts";
import { readHeadlines } from "../src/app/api/sessions/headlines.ts";
import { editHeadlines } from "../src/app/api/sessions/headline-edit.ts";

const key = process.env.CLAUDE_KEY;
if (!key) throw new Error("CLAUDE_KEY required (use op run)");
const snapshot = await readHeadlines(NEWS_DEFAULTS);
const result = await editHeadlines(
  snapshot,
  [],
  "Sunday evening in Dallas, something soulful and curious",
  "Stevie Wonder — As",
  {
    client: new Anthropic({ apiKey: key, maxRetries: 0 }),
    model: process.env.CLAUDE_MODEL ?? "claude-opus-5",
  },
);
console.log(JSON.stringify(result, null, 2));
if (!result.receipt.words) process.exitCode = 1;
