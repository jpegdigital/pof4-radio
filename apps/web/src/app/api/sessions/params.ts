import { z } from "zod";

/**
 * The tunables, one schema each side of the split. Creation takes only the ask and the voice.
 * The knobs are global state for now (they belong to the station concept later, not the
 * session): every default lives here and only here; a production rung accepts a partial Knobs
 * body as a debugging pass-through — anything not sent lands on the default. Pure and parsed
 * at the boundary, so a bad knob is a 400 with zod's why, never a weird playlist.
 */

export const DEFAULTS = { propose: 12, candidates: 5, playlist: 8, min: 4 } as const;

export const Knobs = z
  .object({
    /** Pass 1: how many records Claude names. The only number Spotify sees (one search per pick). */
    propose: z.number().int().min(1).max(50).default(DEFAULTS.propose),
    /** Hydration: Spotify hits kept per pick (the search limit). */
    candidates: z.number().int().min(1).max(10).default(DEFAULTS.candidates),
    /** Pass 2: how many tracks compose keeps. */
    playlist: z.number().int().min(1).max(25).default(DEFAULTS.playlist),
    /** Fewer kept than this and the playlist fails loud, with receipts. */
    min: z.number().int().min(1).max(25).default(DEFAULTS.min),
  })
  .refine((p) => p.min <= p.playlist, { message: "min cannot exceed playlist" });

export type Knobs = z.infer<typeof Knobs>;

export const SessionParams = z.object({
  prompt: z.string().trim().min(1).max(500),
  voiceId: z.string().trim().min(1).max(64),
});

export type SessionParams = z.infer<typeof SessionParams>;
