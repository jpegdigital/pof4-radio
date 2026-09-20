import { z } from "zod";
import { jsonPrompt } from "./template.ts";
import type { MixPlan } from "../../app/api/sessions/planning.ts";
import { ChoiceQuestion } from "./contract.ts";

const loadMix = jsonPrompt(
  "mix",
  z.strictObject({
    action: ChoiceQuestion.extend({
      criteria: z.record(
        z.enum(["segue", "sweeper", "station", "talkup", "break_dry", "break_post", "stop"]),
        z.string().trim().min(1),
      ),
    }),
  }),
);

export const mixPrompt = {
  options: () => loadMix().action.criteria,
  render(actions: Record<string, Omit<MixPlan, "chart">>): ChoiceQuestion {
    const { action } = loadMix();
    return ChoiceQuestion.parse({
      ...action,
      criteria: Object.fromEntries(
        Object.entries(action.criteria).filter(([key]) => key === "stop" || Object.hasOwn(actions, key)),
      ),
    });
  },
};
