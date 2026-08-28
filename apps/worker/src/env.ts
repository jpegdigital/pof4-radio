import { z } from "zod";

/** Every env var the worker reads, validated once at boot. Fail fast, not mid-job. */
const Env = z.object({
  DATABASE_URL: z.string().url(),
  // Search/lookup only — the client-credentials flow. The worker never holds the user's token.
  SPOTIFY_CLIENT_ID: z.string().min(1),
  SPOTIFY_CLIENT_SECRET: z.string().min(1),

  // Not used yet (the DJ loop lands next). Deliberately NOT named ANTHROPIC_API_KEY so loading
  // this env into a shell never hijacks Claude Code or SDK auto-auth.
  CLAUDE_KEY: z.string().optional(),
  CLAUDE_MODEL: z.string().default("claude-sonnet-5"),
  ELEVENLABS_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().optional(),
});

export const env = Env.parse(process.env);
export type Env = typeof env;
