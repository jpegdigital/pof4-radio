import { z } from "zod";

/**
 * The two bodies the routes parse. Creation takes only the ask and the voice. The slot rung
 * takes the browser's clock — ms since the listener's local midnight, so the DJ knows the time
 * where they are and the server knows when the hour turns — and, for another take of a voiced
 * slot, `again`. The clock's pacing (break every, fill, low water) is not a client knob: it is
 * the `settings.clock` row (lib/clock.ts). Parsed at the boundary, so a bad body is a 400 with
 * zod's why.
 */

export const SessionParams = z.object({
  prompt: z.string().trim().min(1).max(500),
  voiceId: z.string().trim().min(1).max(64),
});
export type SessionParams = z.infer<typeof SessionParams>;

export const SlotBody = z.object({
  clockMs: z.number().int().min(0).max(86_400_000),
  again: z.boolean().optional(),
});
export type SlotBody = z.infer<typeof SlotBody>;
