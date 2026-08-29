import { type PromptTemplate, templateFrom } from "@radio/dj";
import { db } from "./db";

/** The DJ's prompts as they stand right now, straight from `settings`. Throws if a slot has no row. */
export async function loadPromptTemplate(): Promise<PromptTemplate> {
  return templateFrom(await db().listSettings());
}
