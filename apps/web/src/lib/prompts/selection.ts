import { z } from "zod";
import { template } from "./template.ts";
import type { Hit } from "../../app/api/sessions/doc.ts";
import { choice, type ChoiceQuestion } from "./contract.ts";

const renderRecording = template("recording", z.strictObject({}));
const renderHeadline = template("headline", z.strictObject({ index: z.number().int().nonnegative() }));

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
  render(index: number): ChoiceQuestion {
    return choice(renderHeadline({ index }), {
      include: "A distinct, worthwhile story for this listener's requested show; suitable to include.",
      omit: "Weak or inappropriate fit, unnecessary interruption, unclear usefulness, or the listener wants no news.",
      repeat:
        "The same event was already selected in history or appears earlier in this menu, even under another title or publisher.",
    });
  },
};
