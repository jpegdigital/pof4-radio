import { z } from "zod";
import { jsonPrompt } from "./template.ts";
import type { Hit } from "../../app/api/sessions/doc.ts";
import { ChoiceQuestion } from "./contract.ts";

const question = (options: [string, ...string[]]) =>
  ChoiceQuestion.extend({
    criteria: z.record(z.enum(options), z.string().trim().min(1)),
  });
const loadChart = jsonPrompt(
  "chart",
  z.strictObject({
    post: question(["0", "1", "2", "3", "4", "5", "beyond_5"]),
    ending: question(["cold", "fade_5", "fade_10", "fade_20", "fade_30", "unknown"]),
    energy: question(["0", "1", "2", "3", "4", "5"]),
    tempo: question(["down", "mid", "up", "unknown"]),
    mood: question([
      "calm",
      "warm",
      "melancholic",
      "tense",
      "bright",
      "driving",
      "dreamy",
      "playful",
      "unknown",
    ]),
  }),
);

export const chartPrompt = {
  render(hit: Hit) {
    const questions = loadChart();
    return {
      ...questions,
      post: ChoiceQuestion.parse({
        ...questions.post,
        criteria: Object.fromEntries(
          Object.entries(questions.post.criteria).filter(([option]) =>
            option === "beyond_5" ? hit.durationMs > 5000 : Number(option) * 1000 < hit.durationMs,
          ),
        ),
      }),
    };
  },
};
