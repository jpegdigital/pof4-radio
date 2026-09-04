import { z } from "zod";

/**
 * The shapes each call is held to, as zod: one schema drives the JSON schema the API is
 * constrained to, parses the answer and types it (`messages.parse` + `zodOutputFormat`). The
 * grammar guarantees required keys and refuses unknown ones, but not an array's length — an
 * unbounded picks[] is how "about 12" came back as 42 — so a call for N things asks for
 * song1…songN, every key required, and reads them back in order (`numbered`). Two shapes: what
 * the proposer names (the fill), and what the writer returns for one slot (the slot rung).
 */

/** One song as the proposer names it: leads for a catalogue search, not gospel. */
export const Proposal = z.object({
  artist: z.string().describe("the artist"),
  title: z.string().describe("the song — a title as you know it"),
  why: z.string().describe("one line: why this song, here"),
});
export type Proposal = z.infer<typeof Proposal>;

export const SLOT_KINDS = ["break", "talkup", "sweeper", "segue"] as const;

/**
 * One slot as the writer returns it, in one answer: the pick (which of the slot's hits plays),
 * the chart (what the writer knows of that version: the ramp, where the vocal lands, how it
 * ends, the feel), the copy (a kind, the words, the break's lead line, why) and the timing (the
 * two numbers the mix follows). The legal ID is not the writer's to produce.
 */
export const Written = z.object({
  pick: z.string().describe("the id of the version you chose, verbatim from the hits"),
  rampSec: z
    .number()
    .describe(
      "how long the instrumental ramp runs before the first vocal, in seconds, on this version; 0 if it starts on the vocal or on spoken words",
    ),
  sure: z.boolean().describe("true only if you are confident of rampSec to within a second or two"),
  post: z
    .string()
    .describe(
      "where the vocal comes in, in a few words and never the lyric itself — 'the title line', 'a count-in, then the verse', 'a held note over the synth'; empty if there is no vocal",
    ),
  outro: z.enum(["cold", "fade"]).describe("how the record ends"),
  outroSec: z
    .number()
    .describe(
      "when the ending begins, in seconds from the start: where the fade starts, or the full length for a cold ending",
    ),
  energy: z.number().int().min(1).max(5).describe("1 (a ballad) to 5 (a floor-filler)"),
  tempo: z.enum(["down", "mid", "up"]),
  mood: z.string().describe("one line"),
  kind: z
    .enum(SLOT_KINDS)
    .describe(
      "what happens at the top of this slot: break = the DJ over a bed, then the lead line into the song; talkup = the DJ over its instrumental ramp, ending a beat before the vocal; sweeper = a short dry station-ID line, then a hard start; segue = nothing, straight out of the last song",
    ),
  words: z
    .string()
    .describe(
      "everything said: the break (without its lead line), the talk-up, or the sweeper's line. Empty for a segue. Never a lyric.",
    ),
  leadLine: z
    .string()
    .describe(
      "the break only: the one sentence that leads into the song, said last, with the song starting under it. Not repeated in words. Empty otherwise.",
    ),
  treatment: z.string().describe("one line: why this kind, here"),
  recordUnderSec: z
    .number()
    .describe(
      "the break only: how many seconds before your voice ends the song starts under you — about the length of the lead line as spoken, 2 to 5. 0 otherwise.",
    ),
  voiceInSec: z
    .number()
    .describe(
      "the talk-up only: how many seconds into the song your voice starts — let the ramp breathe first, usually 1 to 3, and be done a beat before the vocal. 0 otherwise.",
    ),
});
export type Written = z.infer<typeof Written>;

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
