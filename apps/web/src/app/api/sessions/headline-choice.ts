import { prompts } from "../../../lib/prompts/index.ts";
import { z } from "zod";
import type { PreparedHeadline } from "../../../lib/prepared.ts";

export const HEADLINE_CHOICE_VERSION = "headlines-1";
export const MAX_SELECTED_HEADLINES = 1;
export interface HeadlineHistory {
  seq: number;
  articleId: string;
  storyId: string;
  revision: string;
  title: string;
  topic: string;
}
interface Input {
  prompt: string;
  headlines: PreparedHeadline[];
  history: HeadlineHistory[];
  now: number;
}

/** Reuse is forbidden once selected for generation, whether or not the listener heard the clip. */
export function headlineRequest(input: Input, model: string) {
  const seen = new Set<string>();
  const headlines = input.headlines
    .filter((h) => {
      if (
        seen.has(h.articleId) ||
        input.history.some((old) => old.articleId === h.articleId || old.storyId === h.storyId)
      )
        return false;
      seen.add(h.articleId);
      return true;
    })
    .slice(0, 12);
  return {
    model,
    state: {
      prompt: input.prompt,
      now: new Date(input.now).toISOString(),
      headlines,
      history: input.history.slice(-60),
    },
    questions: Object.fromEntries(
      headlines.map((_, index) => [`headline_${index}`, prompts.headlines.render(index)]),
    ),
  };
}
export type HeadlineRequest = ReturnType<typeof headlineRequest>;
const probability = z.number().min(0).max(1);
const Response = z.object({
  model: z.string(),
  answers: z.record(
    z.string(),
    z.object({
      type: z.literal("choice"),
      choice: z.enum(["include", "omit", "repeat"]),
      confidence: probability,
      probabilities: z.strictObject({ include: probability, omit: probability, repeat: probability }),
    }),
  ),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
});
export function readHeadlineChoice(request: HeadlineRequest, raw: unknown, elapsedMs: number) {
  const response = Response.parse(raw);
  const ids = Object.keys(request.questions);
  if (
    response.model !== request.model ||
    Object.keys(response.answers).length !== ids.length ||
    ids.some((id) => !response.answers[id])
  )
    throw new Error("Invalid Jev headline answers");
  for (const answer of Object.values(response.answers)) {
    const sum = Object.values(answer.probabilities).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) > 0.015001) throw new Error("Invalid Jev headline distribution");
  }
  // The explicit choice gates inclusion. Rank accepted options using the same rubric, without
  // an arbitrary confidence threshold or filling empty places with rejected stories.
  const selected = request.state.headlines
    .map((h, i) => ({ h, answer: response.answers[`headline_${i}`], i }))
    .filter(({ answer }) => answer.choice === "include")
    .sort((a, b) => b.answer.probabilities.include - a.answer.probabilities.include || a.i - b.i)
    .slice(0, MAX_SELECTED_HEADLINES)
    .map(({ h }) => h);
  return { version: HEADLINE_CHOICE_VERSION, selected, request, response, elapsedMs };
}
export interface HeadlineChoice {
  version: string;
  selected: PreparedHeadline[];
  request: HeadlineRequest;
  response: z.infer<typeof Response> | null;
  elapsedMs: number;
}
export async function chooseHeadlines(
  input: Input,
  config: { apiKey: string; model: string },
): Promise<HeadlineChoice> {
  const request = headlineRequest(input, config.model);
  if (!request.state.headlines.length)
    return { version: HEADLINE_CHOICE_VERSION, selected: [], request, response: null, elapsedMs: 0 };
  if (!config.apiKey) throw new Error("TYPESAFE_API_KEY is required for headline selection");
  const started = Date.now();
  const response = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Jev headline selection failed (HTTP ${response.status})`);
  return readHeadlineChoice(request, await response.json(), Date.now() - started);
}
