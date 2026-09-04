import { CLOCK_KEY, Clock } from "./clock";
import { pool } from "./db";
import { IDENTITY_KEY, Identity } from "./identity";
import { parseVoices, type Voice, VOICES_KEY } from "./voices";

/**
 * The three `settings` rows the show reads per request, server only (this file touches the pool;
 * the shapes in clock.ts, identity.ts and voices.ts are pure, so the control room's client
 * components can import those). A malformed row throws, naming the key — a fault, not a fallback.
 */

/** The roster. No row is an empty roster (the home shows it, /settings fills it). */
export async function loadVoices(): Promise<Voice[]> {
  const { rows } = await pool().query<{ value: string }>("select value from settings where key = $1", [
    VOICES_KEY,
  ]);
  return rows[0] ? parseVoices(rows[0].value) : [];
}

/** The identity. Throws when the row is missing. */
export async function loadIdentity(): Promise<Identity> {
  const { rows } = await pool().query<{ value: string }>("select value from settings where key = $1", [
    IDENTITY_KEY,
  ]);
  if (!rows[0]) throw new Error(`settings row ${IDENTITY_KEY} is missing — fill it on /settings`);
  const parsed = Identity.safeParse(JSON.parse(rows[0].value));
  if (!parsed.success)
    throw new Error(`settings row ${IDENTITY_KEY} is malformed: ${parsed.error.issues[0]?.message}`);
  return parsed.data;
}

/** The clock. Throws when the row is missing. */
export async function loadClock(): Promise<Clock> {
  const { rows } = await pool().query<{ value: string }>("select value from settings where key = $1", [
    CLOCK_KEY,
  ]);
  if (!rows[0]) throw new Error(`settings row ${CLOCK_KEY} is missing — fill it on /settings`);
  const parsed = Clock.safeParse(JSON.parse(rows[0].value));
  if (!parsed.success)
    throw new Error(`settings row ${CLOCK_KEY} is malformed: ${parsed.error.issues[0]?.message}`);
  return parsed.data;
}
