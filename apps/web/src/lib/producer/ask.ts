import type Anthropic from "@anthropic-ai/sdk";
import { claude } from "@/lib/claude";
import { env } from "@/lib/env";
import { ProducerError } from "./errors";

/**
 * One forced-tool call to the model: the brief goes in, the tool's input comes out. Adaptive
 * thinking is on so a call can reason in its own space before it commits; `effort` is the
 * call's dial. The tool is strict, so the shape is guaranteed; the caller's zod schema then
 * narrows enums and ranges. The system prompt is the `prompt.system` row, passed in.
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

/** A refusal, or the API's output filter (a 400 "blocked by content filtering policy"): worth one more try, never a verdict. */
export const isRefusal = (e: unknown) =>
  e instanceof ProducerError && (e.message.includes("refused") || /content filtering/i.test(e.message));

export async function ask<T>(
  system: string,
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
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral", ttl: "1h" } }],
      messages: [{ role: "user", content: brief }],
      tools: [{ ...tool, strict: true }],
      tool_choice: { type: "tool", name: tool.name },
    });
  } catch (e) {
    throw new ProducerError(502, `claude: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (res.stop_reason === "refusal") throw new ProducerError(502, `claude refused the ${tool.name} brief`);
  const call = res.content.find((c) => c.type === "tool_use");
  if (!call || call.type !== "tool_use")
    throw new ProducerError(502, `claude made no ${tool.name} call (${res.stop_reason})`);
  return { out: call.input as T, usage: usageOf(res.usage) };
}
