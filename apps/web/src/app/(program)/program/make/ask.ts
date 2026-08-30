import type Anthropic from "@anthropic-ai/sdk";
import { claude } from "@/lib/claude";
import { env } from "@/lib/env";
import { MakeError } from "./files";
import { SYSTEM } from "./prompts";

/**
 * One forced-tool call to the model: the brief goes in, the tool's input comes out. Adaptive
 * thinking is on so a stage can reason in its own space before it commits; `effort` is the
 * stage's dial. The tool is strict, so the shape is guaranteed; the stage's zod schema then
 * narrows enums and ranges.
 */
export type Effort = "low" | "medium" | "high";

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const usageOf = (u: Anthropic.Usage): Usage => ({
  input: u.input_tokens,
  output: u.output_tokens,
  cacheRead: u.cache_read_input_tokens ?? 0,
  cacheWrite: u.cache_creation_input_tokens ?? 0,
});

export const sumUsage = (us: Usage[]): Usage =>
  us.reduce(
    (a, u) => ({
      input: a.input + u.input,
      output: a.output + u.output,
      cacheRead: a.cacheRead + u.cacheRead,
      cacheWrite: a.cacheWrite + u.cacheWrite,
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  );

export async function ask<T>(
  brief: string,
  tool: Anthropic.Tool,
  effort: Effort,
): Promise<{ out: T; usage: Usage }> {
  let res: Anthropic.Message;
  try {
    res = await claude().messages.create({
      model: env().CLAUDE_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort },
      system: SYSTEM,
      messages: [{ role: "user", content: brief }],
      tools: [{ ...tool, strict: true }],
      tool_choice: { type: "tool", name: tool.name },
    });
  } catch (e) {
    throw new MakeError(502, `claude: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (res.stop_reason === "refusal") throw new MakeError(502, `claude refused the ${tool.name} brief`);
  const call = res.content.find((c) => c.type === "tool_use");
  if (!call || call.type !== "tool_use")
    throw new MakeError(502, `claude made no ${tool.name} call (${res.stop_reason})`);
  return { out: call.input as T, usage: usageOf(res.usage) };
}
