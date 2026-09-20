import { askJev, type JevResponse, readJev } from "../../../lib/jev.ts";
import { prompts } from "../../../lib/prompts/index.ts";
import type { PreparedHeadline } from "../../../lib/prepared.ts";

export const HEADLINE_CHOICE_VERSION = "headlines-2";
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
  const seenStories = new Set<string>();
  const headlines = input.headlines
    .filter((h) => {
      if (
        seen.has(h.articleId) ||
        seenStories.has(h.storyId) ||
        input.history.some((old) => old.articleId === h.articleId || old.storyId === h.storyId)
      )
        return false;
      seen.add(h.articleId);
      seenStories.add(h.storyId);
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
    questions: prompts.headlines.render(headlines),
  };
}
export type HeadlineRequest = ReturnType<typeof headlineRequest>;
export function readHeadlineChoice(request: HeadlineRequest, raw: unknown, elapsedMs: number) {
  const response = readJev(request, raw);
  // Count decides whether to air news; the competing headline probabilities order the stories.
  const selected = request.state.headlines
    .map((h, i) => ({ h, probability: response.answers.ranking.probabilities[`headline_${i}`], i }))
    .sort((a, b) => b.probability - a.probability || a.i - b.i)
    .slice(0, Number(response.answers.count.choice))
    .map(({ h }) => h);
  return { version: HEADLINE_CHOICE_VERSION, selected, request, response, elapsedMs };
}
export interface HeadlineChoice {
  version: string;
  selected: PreparedHeadline[];
  request: HeadlineRequest;
  response: JevResponse | null;
  elapsedMs: number;
}
export async function chooseHeadlines(
  input: Input,
  config: { apiKey: string; model: string },
): Promise<HeadlineChoice> {
  const request = headlineRequest(input, config.model);
  if (!request.state.headlines.length)
    return { version: HEADLINE_CHOICE_VERSION, selected: [], request, response: null, elapsedMs: 0 };
  const { raw, elapsedMs } = await askJev(request, { apiKey: config.apiKey, what: "headline selection" });
  return readHeadlineChoice(request, raw, elapsedMs);
}
