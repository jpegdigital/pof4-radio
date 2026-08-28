import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";

// One client per server process. No SDK retries: a segment is a 20–60 s billed call and the
// browser retries once on its own terms.
const g = globalThis as unknown as { __claude?: Anthropic };

export function claude(): Anthropic {
  g.__claude ??= new Anthropic({ apiKey: env().CLAUDE_KEY, maxRetries: 0 });
  return g.__claude;
}
