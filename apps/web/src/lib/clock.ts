import { z } from "zod";

/**
 * The clock: how the show is paced. One JSON row in `settings` (`CLOCK_KEY`), edited on
 * /settings and read per request (settings.ts) by the fill rung, the slot rung and the snapshot.
 * There is no default in code: a missing row is a fault. Pure, so the control room's form can
 * import it.
 *
 *   breakEvery  a break at slot 1 and every this-many after (5 → 1, 6, 11…)
 *   fill        how many slots one fill proposes
 *   lowWater    the browser asks for a fill when this many or fewer slots are still unwritten
 */

export const CLOCK_KEY = "clock";

export const Clock = z.object({
  breakEvery: z.number().int().min(1),
  fill: z.number().int().min(1),
  lowWater: z.number().int().min(1),
});
export type Clock = z.infer<typeof Clock>;
