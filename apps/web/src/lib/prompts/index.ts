import { chartPrompt } from "./chart.ts";
import { fillPrompt } from "./fill.ts";
import { mixPrompt } from "./mix.ts";
import { newsPreparePrompt, newsReviewPrompt } from "./news.ts";
import { headlinePrompt, recordingPrompt } from "./selection.ts";
import { writePrompt } from "./write.ts";

/** Code-owned prompts. Callers supply context and own API execution, never instruction text. */
export const prompts = {
  fill: fillPrompt,
  write: writePrompt,
  recording: recordingPrompt,
  chart: chartPrompt,
  mix: mixPrompt,
  headlines: headlinePrompt,
  newsPrepare: newsPreparePrompt,
  newsReview: newsReviewPrompt,
} as const;
export type PromptName = keyof typeof prompts;
