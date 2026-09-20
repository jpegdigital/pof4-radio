import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { claude } from "@/lib/claude";
import { env } from "@/lib/env";
import type { Identity } from "@/lib/identity";
import { prompts } from "../../../lib/prompts/index.ts";
import type { WriteInput } from "../../../lib/prompts/write.ts";
import type { Written } from "./shapes";
export type { WriteInput, RecentSlot } from "../../../lib/prompts/write.ts";

export const legalIdOf = (i: Identity) => `${i.calls}, ${i.city}. ${i.onAir}.`;

/** "8:43 pm" from ms since midnight — the clock as the brief says it. */
export function clockOf(ms: number): string {
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  return `${h % 12 || 12}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

export interface WriterReceipt {
  version: "script-2";
  model: string | null;
  system: string;
  brief: string;
  response: unknown;
  usage: unknown;
  elapsedMs: number;
}

export async function produceWrite(input: WriteInput): Promise<{ written: Written; receipt: WriterReceipt }> {
  const started = Date.now();
  const { system: instructions, brief } = prompts.write.render(input);
  if (input.plan.fixedWords !== undefined) {
    const written = { words: input.plan.fixedWords, leadLine: "" };
    return {
      written,
      receipt: {
        version: "script-2",
        model: null,
        system: instructions,
        brief,
        response: written,
        usage: null,
        elapsedMs: 0,
      },
    };
  }
  const model = env().CLAUDE_MODEL;
  const res = await claude().messages.parse(
    {
      model,
      max_tokens: 2048,
      thinking: { type: "disabled" },
      output_config: { format: zodOutputFormat(prompts.write.output) },
      system: instructions,
      messages: [{ role: "user", content: brief }],
    },
    { timeout: 60_000 },
  );
  if (!res.parsed_output)
    throw new Error(`slot ${input.seq}: Claude returned no usable copy (${res.stop_reason})`);
  const written = prompts.write.output.parse(res.parsed_output);
  for (const headline of input.headlines)
    if (!written.words.toLowerCase().includes(headline.source.toLowerCase()))
      throw new Error(`Claude omitted publisher attribution: ${headline.source}`);
  return {
    written,
    receipt: {
      version: "script-2",
      model,
      system: instructions,
      brief,
      response: res.content,
      usage: res.usage,
      elapsedMs: Date.now() - started,
    },
  };
}
