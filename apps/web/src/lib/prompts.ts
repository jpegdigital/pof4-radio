import { Identity, type PromptTemplate, templateFrom } from "@radio/dj";
import { db } from "./db";

/** The producer's prompts as they stand right now, straight from `settings`. Throws if a slot has no row. */
export async function loadPromptTemplate(): Promise<PromptTemplate> {
  return templateFrom(await db().listSettings());
}

export const IDENTITY_KEY = "station.identity";

/** The station's identity (`settings.station.identity`). Throws, naming the key, when the row is missing or malformed. */
export async function loadIdentity(): Promise<Identity> {
  const row = await db().getSetting(IDENTITY_KEY);
  if (!row) throw new Error(`settings row ${IDENTITY_KEY} is missing — fill it on /settings`);
  const parsed = Identity.safeParse(JSON.parse(row.value));
  if (!parsed.success)
    throw new Error(`settings row ${IDENTITY_KEY} is malformed: ${parsed.error.issues[0]?.message}`);
  return parsed.data;
}
