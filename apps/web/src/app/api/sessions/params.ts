import { z } from "zod";

/**
 * The session's tunables, one schema: the form posts what the user touched, everything else
 * lands on a default here — the only place the defaults live. Pure and parsed at the boundary,
 * so a bad knob is a 400 with zod's why, never a weird playlist.
 */

export const DEFAULTS = { propose: 12, candidates: 5, playlist: 8, min: 4 } as const;

export const SessionParams = z
  .object({
    prompt: z.string().trim().min(1).max(500),
    voiceId: z.string().trim().min(1).max(64),
    /** Pass 1: how many records Claude names. The only number Spotify sees (one search per pick). */
    propose: z.number().int().min(1).max(50).default(DEFAULTS.propose),
    /** Hydration: Spotify hits kept per pick (the search limit). */
    candidates: z.number().int().min(1).max(10).default(DEFAULTS.candidates),
    /** Pass 2: how many tracks compose keeps. */
    playlist: z.number().int().min(1).max(25).default(DEFAULTS.playlist),
    /** Fewer kept than this and the session fails loud, with receipts. */
    min: z.number().int().min(1).max(25).default(DEFAULTS.min),
  })
  .refine((p) => p.min <= p.playlist, { message: "min cannot exceed playlist" });

export type SessionParams = z.infer<typeof SessionParams>;
