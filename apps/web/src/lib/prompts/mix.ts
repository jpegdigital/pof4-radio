import { z } from "zod";
import { template } from "./template.ts";
import type { MixPlan } from "../../app/api/sessions/planning.ts";
import { choice, type ChoiceQuestion } from "./contract.ts";

const renderMix = template("mix", z.strictObject({}));

export const mixPrompt = {
  copy: {
    breakDry: "Zero overlap: DJ over a bed, then start the recording after the lead line.",
    breakUnder: (seconds: number) =>
      "DJ over a bed; start the recording " +
      seconds +
      " seconds before the voice ends, under the closing copy and lead line.",
    segue: "Zero overlap: let the music continue with no voice.",
    identify: (copyStyle: "station" | "identify", words: string) =>
      (copyStyle === "station" ? "Complete station ID" : "Complete song and artist ID") +
      ": " +
      JSON.stringify(words),
    context:
      "One complete, specific thought connecting this track to the show, including the artist or song naturally. No isolated title, surname, slogan, or invented trivia.",
    sweeper: (description: string) => "Zero overlap: " + description + ", then start the recording.",
    talkup: (description: string, start: number, seconds: number) =>
      description +
      " Start the recording, then bring the DJ in at " +
      start +
      " seconds for approximately " +
      seconds +
      " seconds at a natural pace. Keep the complete introduction; do not shorten it to a fragment.",
  },
  render(actions: Record<string, Omit<MixPlan, "chart">>): ChoiceQuestion {
    return choice(renderMix({}), {
      ...Object.fromEntries(Object.entries(actions).map(([id, action]) => [id, action.treatment])),
      stop: "No supplied action can satisfy an explicit requirement in the listener request; stop preparation.",
    });
  },
};
