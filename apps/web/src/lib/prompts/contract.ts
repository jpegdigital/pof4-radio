import { z } from "zod";

/** Rendered prompt contracts, independent of model clients and database access. */
const Text = z.string().refine((value) => value.trim().length > 0, "Prompt text must not be blank");
export const ChatPrompt = z.strictObject({ system: Text, brief: Text });
export type ChatPrompt = z.infer<typeof ChatPrompt>;
export const ChoiceQuestion = z.strictObject({
  type: z.literal("choice"),
  instructions: Text,
  criteria: z.record(Text, Text).refine((menu) => Object.keys(menu).length > 0, "A choice needs options"),
});
export type ChoiceQuestion = z.infer<typeof ChoiceQuestion>;
export const choice = (instructions: string, criteria: Record<string, string>): ChoiceQuestion =>
  ChoiceQuestion.parse({ type: "choice", instructions, criteria });
