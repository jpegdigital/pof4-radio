import { z } from "zod";

/** Server-only env for the web app. Read lazily so `next build` doesn't need real values. */
const Env = z.object({
  DATABASE_URL: z.string().url(),
  /**
   * The records (api/sessions/qobuz.ts): the search behind the playlist and the pull behind each
   * record. The token is the listener's own from play.qobuz.com — required, there is no show
   * without it. The app id + secret pair is the web player's, printed by `scripts/qobuz-smoke.mts`;
   * set both to skip the ~3 s bundle scrape on the first call — when the pair stops signing the
   * scrape runs anyway.
   */
  QOBUZ_TOKEN: z.string().min(1),
  QOBUZ_APP_ID: z
    .string()
    .regex(/^\d{9}$/)
    .optional(),
  QOBUZ_SECRET: z.string().min(1).optional(),
  /** The DJ. */
  CLAUDE_KEY: z.string().min(1),
  CLAUDE_MODEL: z.string().min(1).default("claude-opus-5"),
  /** The voice. Optional so the station runs (talk skipped) before the key is set up. */
  ELEVENLABS_KEY: z.string().min(1).optional(),
  /**
   * The clips bucket (Railway's `radio-clips`, S3-compatible). Optional as a group: with any of
   * the five unset, `bucket()` is null and the voice/clip routes answer 503. Railway sets them from
   * the bucket's refs (`railway variables -s radio-web`); locally they come from the 1Password item
   * `pof4-radio-clips-bucket` through `.env.op`.
   */
  BUCKET_ENDPOINT: z.string().url().optional(),
  BUCKET_NAME: z.string().min(1).optional(),
  BUCKET_REGION: z.string().min(1).optional(),
  BUCKET_ACCESS_KEY_ID: z.string().min(1).optional(),
  BUCKET_SECRET_ACCESS_KEY: z.string().min(1).optional(),
});

let cached: z.infer<typeof Env> | null = null;
export function env() {
  cached ??= Env.parse(process.env);
  return cached;
}
