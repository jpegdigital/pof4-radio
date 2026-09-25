import { z } from "zod";
import { jsonPrompt, template } from "./template.ts";
import type { Hit } from "../../app/api/sessions/doc.ts";
import type { RawHeadline } from "../prepared.ts";
import { choice, ChoiceQuestion } from "./contract.ts";

const renderRecording = template("recording", z.strictObject({}));
const loadHeadlines = jsonPrompt(
  "headlines",
  z.strictObject({
    selection: ChoiceQuestion.omit({ criteria: true }),
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
  render(headlines: RawHeadline[], allowNone = false): Record<string, ChoiceQuestion> {
    if (!headlines.length) return {};
    const questions = loadHeadlines();
    return {
      selection: ChoiceQuestion.parse({
        ...questions.selection,
        criteria: {
          ...(allowNone ? { none: "No further headline deserves airtime in this break." } : {}),
          ...Object.fromEntries(
            headlines.map((h, index) => [
              `headline_${index}`,
              `headlines[${index}]: ${h.title} (${h.source})`,
            ]),
          ),
        },
      }),
    };
  },
};
