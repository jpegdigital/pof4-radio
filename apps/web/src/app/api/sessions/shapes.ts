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

/** Claude writes only the spoken copy for Jev's fixed plan. */
export const Written = z.strictObject({
  words: z
    .string()
    .describe(
      "Spoken copy within the supplied word budget. No legal ID, lyrics or stage directions. Empty only for a segue.",
    ),
  leadLine: z
    .string()
    .describe(
      "The break's final sentence introducing the recording, within its separate word budget. Empty for all other kinds.",
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
