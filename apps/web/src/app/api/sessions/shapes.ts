import { z } from "zod";

/**
 * The shapes each call is held to, as zod: one schema drives the JSON schema the API is
 * constrained to, parses the answer and types it (`messages.parse` + `zodOutputFormat`). The
 * grammar guarantees required keys and refuses unknown ones, but not an array's length — an
 * unbounded picks[] is how "about 12" came back as 42 — so a call for N things asks for
 * song1…songN, every key required, and reads them back in order (`numbered`).
 */

export const Pick = z.object({
  artist: z.string().describe("the artist"),
  title: z.string().describe("the record — a song title as you know it"),
  why: z.string().describe("one line: why this record, here"),
});
export type Pick = z.infer<typeof Pick>;

/** One composed slot: a candidate id and a why written for this playlist. */
export const Choice = z.object({
  id: z
    .string()
    .describe('a candidate track id, verbatim, for this play-order slot — or "" if no candidate deserves it'),
  why: z
    .string()
    .describe("one line: why this track, here, in this playlist — written for the set, not the search"),
});
export type Choice = z.infer<typeof Choice>;

export const SLOT_KINDS = ["break", "talkup", "sweeper", "segue"] as const;

/**
 * One slot as the writer returns it: a kind, the words, the break's lead line, and why. The
 * legal ID is not the writer's to produce (the server prepends it on the top-of-hour break).
 */
export const Slot = z.object({
  kind: z
    .enum(SLOT_KINDS)
    .describe(
      "what happens at the top of this record: break = the DJ over a bed, then the lead line into it (slot 1 only); talkup = the DJ over its instrumental intro, ending a beat before the vocal; sweeper = a short dry station-ID line, then a hard intro; segue = nothing, straight out of the last record",
    ),
  words: z
    .string()
    .describe(
      "everything said: the break (without its lead line), the talk-up, or the sweeper's line. Empty for a segue. Never a lyric.",
    ),
  leadLine: z
    .string()
    .describe(
      "the break only: the one sentence that leads into the record, said last, with the record starting under it. Not repeated in words. Empty otherwise.",
    ),
  recordUnderSec: z
    .number()
    .describe(
      "the break only: how many seconds before your voice ends the record starts under you — about the length of the lead line as spoken, 2 to 5. 0 otherwise.",
    ),
  voiceInSec: z
    .number()
    .describe(
      "the talk-up only: how many seconds into the record your voice starts — let the intro breathe first, usually 1 to 3, and be done a beat before the vocal. 0 otherwise.",
    ),
  why: z.string().describe("one line: why this treatment here"),
});
export type Slot = z.infer<typeof Slot>;

/** The facts of one record's card as the music director returns them; the record's own fields are ours. */
export const CardFacts = z.object({
  introMs: z
    .number()
    .int()
    .describe(
      "how long the instrumental intro runs before the first vocal, in milliseconds, on the single version; 0 if it starts on the vocal or on spoken words",
    ),
  sure: z.boolean().describe("true only if you are confident of introMs to within a second or two"),
  post: z
    .string()
    .describe(
      "where the vocal comes in, in a few words and never the lyric itself — 'the title line', 'a count-in, then the verse', 'a held note over the synth'; empty if there is no vocal",
    ),
  outro: z.enum(["cold", "fade"]).describe("how the record ends"),
  outroMs: z
    .number()
    .int()
    .describe(
      "when the ending begins, in milliseconds from the start: where the fade starts, or the full length for a cold ending",
    ),
  energy: z.number().int().min(1).max(5).describe("1 (a ballad) to 5 (a floor-filler)"),
  tempo: z.enum(["down", "mid", "up"]),
  mood: z.string().describe("one line"),
  notes: z
    .array(z.string())
    .describe("two or three talking points a DJ could say on air: true, short, safe to broadcast, no lyrics"),
});
export type CardFacts = z.infer<typeof CardFacts>;

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

/**
 * key1…keyN, every one required: `shape` spreads into the object the call is held to, `list`
 * reads the answer back in order — a missing key is an error, never a hole.
 */
export function numbered<K extends string, T extends z.ZodType>(key: K, n: number, item: T) {
  const keys = range(n).map((i) => `${key}${i}` as const);
  return {
    shape: Object.fromEntries(keys.map((k) => [k, item])) as Record<`${K}${number}`, T>,
    list: (out: Record<`${K}${number}`, z.infer<T>>): z.infer<T>[] =>
      keys.map((k) => {
        const v = out[k];
        if (v === undefined) throw new Error(`${k} is missing from the answer`);
        return v;
      }),
  };
}
