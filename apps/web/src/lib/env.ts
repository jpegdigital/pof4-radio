import { z } from "zod";

/** Server-only env for the web app. Read lazily so `next build` doesn't need real values. */
const Env = z.object({
  DATABASE_URL: z.string().url(),
  SPOTIFY_CLIENT_ID: z.string().min(1),
  SPOTIFY_CLIENT_SECRET: z.string().min(1),
  /** Must match the Spotify app's registered redirect URI exactly (scheme, host, port, path). */
  SPOTIFY_REDIRECT_URI: z.string().url(),
});

let cached: z.infer<typeof Env> | null = null;
export function env() {
  cached ??= Env.parse(process.env);
  return cached;
}
