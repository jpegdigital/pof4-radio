import { type PromptTemplate, templateFrom } from "@radio/dj";
import { db } from "./db";

/** The DJ's prompts as they stand right now: every edited slot from `settings`, the rest at their defaults. */
export async function loadPromptTemplate(): Promise<PromptTemplate> {
  return templateFrom(await db().listSettings());
}
