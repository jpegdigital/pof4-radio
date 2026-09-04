import { z } from "zod";

/**
 * Who the station is: call letters, city, and the name as it is said on air. One JSON row in
 * `settings` (`IDENTITY_KEY`), edited on /settings and read per slot (settings.ts) for the
 * writer's brief and the legal ID. Pure, so the control room's form can import it.
 */

export const IDENTITY_KEY = "station.identity";

export const Identity = z.object({
  calls: z.string().min(1),
  city: z.string().min(1),
  onAir: z.string().min(1),
});
export type Identity = z.infer<typeof Identity>;
