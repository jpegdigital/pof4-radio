import { askJev, type JevResponse, readJev } from "../../../lib/jev.ts";
import { prompts } from "../../../lib/prompts/index.ts";
import type { RawHeadline } from "../../../lib/prepared.ts";

export const HEADLINE_CHOICE_VERSION = "raw-headlines-2";
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
  headlines: RawHeadline[];
  history: HeadlineHistory[];
  now: number;
  selected?: RawHeadline[];
}

/** Choose from the complete bounded source menu, excluding exact reservations in code. */
export function headlineRequest(input: Input, model: string) {
  const seen = new Set<string>();
  const seenStories = new Set<string>();
  const selected = input.selected ?? [];
  const previous = [...input.history, ...selected];
  const headlines = input.headlines
    .filter((h) => {
      if (
        seen.has(h.articleId) ||
        seenStories.has(h.storyId) ||
        previous.some((old) => old.articleId === h.articleId || old.storyId === h.storyId)
      )
        return false;
      seen.add(h.articleId);
      seenStories.add(h.storyId);
      return true;
    })
    .slice(0, 114);
  return {
    model,
    state: {
      prompt: input.prompt,
      now: new Date(input.now).toISOString(),
      headlines,
      selected,
      history: input.history.slice(-60),
    },
    questions: prompts.headlines.render(headlines, selected.length > 0),
  };
}
export type HeadlineRequest = ReturnType<typeof headlineRequest>;
export function readHeadlineChoice(request: HeadlineRequest, raw: unknown, elapsedMs: number) {
  const response = readJev(request, raw);
  const choice = response.answers.selection.choice;
  const selected =
    choice === "none" ? [] : [request.state.headlines[Number(choice.slice("headline_".length))]];
  return { version: HEADLINE_CHOICE_VERSION, selected, request, response, elapsedMs };
}
export interface HeadlineChoice {
  version: string;
  selected: RawHeadline[];
  request: HeadlineRequest;
  response: JevResponse | null;
  elapsedMs: number;
  followup?: { request: HeadlineRequest; response: JevResponse; elapsedMs: number };
}
/** A second Choice depends on the first: it must add a distinct worthwhile story, or choose none. */
export async function chooseHeadlines(
  input: Input,
  config: { apiKey: string; model: string; fetchFn?: typeof fetch },
): Promise<HeadlineChoice> {
  const request = headlineRequest(input, config.model);
  if (!request.state.headlines.length)
    return { version: HEADLINE_CHOICE_VERSION, selected: [], request, response: null, elapsedMs: 0 };
  const first = await askJev(request, {
    apiKey: config.apiKey,
    fetchFn: config.fetchFn,
    what: "headline selection",
  });
  const result: HeadlineChoice = readHeadlineChoice(request, first.raw, first.elapsedMs);
  const secondRequest = headlineRequest({ ...input, selected: result.selected }, config.model);
  if (!secondRequest.state.headlines.length) return result;
  const second = await askJev(secondRequest, {
    apiKey: config.apiKey,
    fetchFn: config.fetchFn,
    what: "second headline selection",
  });
  const followup = readHeadlineChoice(secondRequest, second.raw, second.elapsedMs);
  return {
    ...result,
    selected: [...result.selected, ...followup.selected],
    elapsedMs: result.elapsedMs + followup.elapsedMs,
    followup: { request: secondRequest, response: followup.response, elapsedMs: followup.elapsedMs },
  };
}
