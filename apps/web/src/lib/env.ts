import { z } from "zod";

/**
 * Server-only env for the web app, and the one place a variable is required: a missing one is a
 * fault naming it here, never a check at the call site. Read lazily so `next build` doesn't need
 * real values; `instrumentation.ts` reads it once as the server starts, so a bad deploy fails to boot.
 */
const Env = z.object({
  DATABASE_URL: z.string().url(),
  /**
   * The tracks (api/sessions/qobuz.ts): the search behind the fill and the pull behind each
   * pick. The token is the listener's own from play.qobuz.com — required, there is no show
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
  /** Jev recording selection. Required; there is no alternate picker. */
  TYPESAFE_API_KEY: z.string().min(1),
  TYPESAFE_MODEL: z.string().min(1).default("jev-1.13.0"),
  /** The voice: every spoken slot is one ElevenLabs take. Required; an unvoiced slot never completes. */
  ELEVENLABS_KEY: z.string().min(1),
  /**
   * The clips bucket (Railway's `radio-clips`, S3-compatible), holding the voice clips and the
   * tracks. Required: every track plays from it. Railway sets the five from the bucket's refs
   * (`railway variables -s radio-web`); locally they come from the 1Password item
   * `pof4-radio-clips-bucket` through `.env.op`.
   */
  BUCKET_ENDPOINT: z.string().url(),
  BUCKET_NAME: z.string().min(1),
  BUCKET_REGION: z.string().min(1),
  BUCKET_ACCESS_KEY_ID: z.string().min(1),
  BUCKET_SECRET_ACCESS_KEY: z.string().min(1),
});

let cached: z.infer<typeof Env> | null = null;
export function env() {
  cached ??= Env.parse(process.env);
  return cached;
}
