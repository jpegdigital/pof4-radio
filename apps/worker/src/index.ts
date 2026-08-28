import Anthropic from "@anthropic-ai/sdk";
import { createDb, SEGMENT_QUEUE } from "@radio/db";
import { clientCredentialsToken, searchTracks } from "@radio/spotify";
import { PgBoss } from "pg-boss";
import { z } from "zod";
import { planSegment } from "./dj.ts";
import { env } from "./env.ts";

/**
 * The worker: a long-running process that owns the segment queue.
 *   segment jobs: { segmentId } → the DJ (Claude, with search_spotify) plans intro / 3–4
 *   tracks / outro against the listener's prompt and what's played recently → the row goes
 *   `ready` and the player picks it up. Jobs are sent with retryLimit 0: a failed segment is
 *   terminal, the player just asks for another — never an automatic second billed run.
 * The schema is applied from a developer machine (`pnpm db:apply`), never at boot.
 */
const SegmentJob = z.object({ segmentId: z.uuid() });

const db = createDb(env.DATABASE_URL);
await db.pool.query("select 1");

const claude = new Anthropic({ apiKey: env.CLAUDE_KEY, maxRetries: 0 });

// App token for search, refreshed a minute early. The worker never holds the user's token.
let app: { token: string; expiresAt: number } | null = null;
async function appToken(): Promise<string> {
  if (app && app.expiresAt - Date.now() > 60_000) return app.token;
  const t = await clientCredentialsToken({
    clientId: env.SPOTIFY_CLIENT_ID,
    clientSecret: env.SPOTIFY_CLIENT_SECRET,
  });
  app = { token: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 };
  return app.token;
}
const search = async (q: string, limit: number) => searchTracks(await appToken(), q, limit);

const boss = new PgBoss({ connectionString: env.DATABASE_URL });
boss.on("error", (err) => console.error("[pg-boss]", err));
await boss.start();
await boss.createQueue(SEGMENT_QUEUE); // idempotent

let current: AbortController | null = null;
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

await boss.work(SEGMENT_QUEUE, { batchSize: 1 }, async ([job]) => {
  const { segmentId } = SegmentJob.parse(job!.data);
  const tag = `[segment ${segmentId.slice(0, 8)}]`;
  const segment = await db.getSegment(segmentId);
  if (!segment) throw new Error(`${tag} row not found`);
  if (segment.status !== "queued") {
    console.warn(`${tag} is ${segment.status}, skipping`);
    return;
  }
  const abort = (current = new AbortController());
  console.log(`${tag} planning "${segment.listenerPrompt}" with ${env.CLAUDE_MODEL}`);
  try {
    await db.startSegment(segmentId, env.CLAUDE_MODEL);
    const recentlyPlayed = await db.recentTracks(); // newest first; includes this row's siblings still planning
    const out = await planSegment(
      { listenerPrompt: segment.listenerPrompt, recentlyPlayed },
      { client: claude, model: env.CLAUDE_MODEL, search, signal: abort.signal },
    );
    await db.finishSegment(segmentId, out);
    console.log(`${tag} ready: ${out.tracks.map((t) => `${t.artists[0]} – ${t.name}`).join(" | ")}`);
  } catch (err) {
    const msg = abort.signal.aborted ? "interrupted: the worker restarted" : errorMessage(err);
    console.warn(`${tag} failed: ${msg}`);
    await db.failSegment(segmentId, msg).catch((e) => console.error(`${tag} failSegment failed:`, e));
    throw err; // pg-boss records it; retryLimit 0 means that's the end
  } finally {
    if (current === abort) current = null;
  }
});

console.log(`worker up — waiting for "${SEGMENT_QUEUE}" jobs`);

let stopping = false;
async function shutdown(sig: string) {
  if (stopping) return;
  stopping = true;
  console.log(`${sig}: stopping…`);
  current?.abort();
  await boss.stop({ graceful: true, timeout: 10_000 });
  await db.close();
  process.exit(0);
}
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => void shutdown(sig));
}
