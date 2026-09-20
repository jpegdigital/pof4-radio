import { z } from "zod";
import { template } from "./template.ts";
import type { Hit } from "../../app/api/sessions/doc.ts";
import { choice } from "./contract.ts";

const renderChart = template(
  "chart",
  z.strictObject({
    intro: z.boolean(),
    ending: z.boolean(),
    energy: z.boolean(),
    tempo: z.boolean(),
    mood: z.boolean(),
  }),
);

export const chartPrompt = {
  render(hit: Hit, introSeconds: readonly number[]) {
    return {
      intro: choice(renderChart({ intro: true, ending: false, energy: false, tempo: false, mood: false }), {
        ...Object.fromEntries(
          introSeconds
            .filter((s) => s * 1000 < hit.durationMs)
            .map((s, index) => [
              String(s),
              s === 0
                ? "Vocals or speech start immediately, or less than one second in."
                : "First vocal at least " +
                  s +
                  " seconds in" +
                  (introSeconds[index + 1] ? ", but before " + introSeconds[index + 1] + " seconds." : "."),
            ]),
        ),
        instrumental: "Known instrumental recording, no vocals or speech.",
        unknown: "Cannot estimate the first-vocal timing for this recording from the supplied identity.",
      }),
      ending: choice(renderChart({ intro: false, ending: true, energy: false, tempo: false, mood: false }), {
        cold: "Ends without a fade.",
        fade_5: "Fades during approximately the final 5 seconds.",
        fade_10: "Fades during approximately the final 10 seconds.",
        fade_20: "Fades during approximately the final 20 seconds.",
        fade_30: "Fades during approximately the final 30 seconds.",
        unknown: "Ending unknown for this version.",
      }),
      energy: choice(renderChart({ intro: false, ending: false, energy: true, tempo: false, mood: false }), {
        "1": "Very restrained and gentle.",
        "2": "Relaxed, low energy.",
        "3": "Moderate energy.",
        "4": "Lively and energetic.",
        "5": "Intense, peak energy.",
        "0": "Unknown recording; cannot estimate energy.",
      }),
      tempo: choice(renderChart({ intro: false, ending: false, energy: false, tempo: true, mood: false }), {
        down: "Slow.",
        mid: "Moderate.",
        up: "Fast.",
        unknown: "Cannot estimate tempo.",
      }),
      mood: choice(renderChart({ intro: false, ending: false, energy: false, tempo: false, mood: true }), {
        calm: "Quiet and restful.",
        warm: "Warm and soulful.",
        melancholic: "Sad or wistful.",
        tense: "Tense or dark.",
        bright: "Joyful and bright.",
        driving: "Forceful and propulsive.",
        dreamy: "Dreamy or atmospheric.",
        playful: "Playful and light.",
        unknown: "Cannot estimate mood.",
      }),
    };
  },
};
