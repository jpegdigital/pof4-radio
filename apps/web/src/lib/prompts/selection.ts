import { z } from "zod";
import { jsonPrompt, template } from "./template.ts";
import type { Hit } from "../../app/api/sessions/doc.ts";
import type { PreparedHeadline } from "../prepared.ts";
import { choice, ChoiceQuestion } from "./contract.ts";

const renderRecording = template("recording", z.strictObject({}));
const loadHeadlines = jsonPrompt(
  "headlines",
  z.strictObject({
    ranking: ChoiceQuestion.omit({ criteria: true }),
    count: ChoiceQuestion.extend({
      criteria: z.strictObject({
        "0": z.string().trim().min(1),
        "1": z.string().trim().min(1),
        "2": z.string().trim().min(1),
      }),
    }),
  }),
);

export const recordingPrompt = {
  render(hits: Hit[]): ChoiceQuestion {
    return choice(renderRecording({}), {
      ...Object.fromEntries(
        hits.map((h) => [
          h.id,
          `${h.artists.join(", ")} — ${h.title}; album: ${h.album}; duration: ${h.durationMs} ms`,
        ]),
      ),
      none: "None of the supplied recordings matches the proposed song and the requested version.",
    });
  },
};

export const headlinePrompt = {
  render(headlines: PreparedHeadline[]): Record<string, ChoiceQuestion> {
    if (!headlines.length) return {};
    const questions = loadHeadlines();
    return {
      ranking: ChoiceQuestion.parse({
        ...questions.ranking,
        criteria: Object.fromEntries(
          headlines.map((h, index) => [`headline_${index}`, `headlines[${index}]: ${h.title} (${h.source})`]),
        ),
      }),
      count: ChoiceQuestion.parse({
        ...questions.count,
        criteria: Object.fromEntries(
          Object.entries(questions.count.criteria).filter(([count]) => Number(count) <= headlines.length),
        ),
      }),
    };
  },
};
