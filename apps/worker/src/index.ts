import { createDb } from "@radio/db";
import { clientCredentialsToken, searchTracks } from "@radio/spotify";
import { PgBoss } from "pg-boss";
import { env } from "./env.ts";

/**
 * The worker: a long-running process that will own the segment queue.
 * Prototype scope — prove the plumbing from this container:
 *   1. Postgres reachable (createDb + select 1)
 *   2. pg-boss starts (keeps its own tables in the `pgboss` schema) and the queue exists
 *   3. Spotify reachable with the app token (one fixed search, logged)
 * Then wait. The DJ loop (Claude → Spotify → ElevenLabs → bucket) plugs into SEGMENT_QUEUE next.
 */
export const SEGMENT_QUEUE = "segment";

const db = createDb(env.DATABASE_URL);
await db.pool.query("select 1");
console.log("postgres ok");

const boss = new PgBoss({ connectionString: env.DATABASE_URL });
boss.on("error", (err) => console.error("[pg-boss]", err));
await boss.start();
await boss.createQueue(SEGMENT_QUEUE); // idempotent
console.log(`pg-boss ok — queue "${SEGMENT_QUEUE}"`);

try {
  const t = await clientCredentialsToken({
    clientId: env.SPOTIFY_CLIENT_ID,
    clientSecret: env.SPOTIFY_CLIENT_SECRET,
  });
  const tracks = await searchTracks(t.access_token, "artist:Khruangbin", 3);
  console.log("spotify ok —", tracks.map((x) => `${x.artists.join(", ")} – ${x.name}`).join(" | "));
} catch (err) {
  console.error("spotify search failed:", err);
}

await boss.work(SEGMENT_QUEUE, { batchSize: 1 }, ([job]) => {
  console.log(`[segment ${job!.id}] received`, job!.data, "— no handler yet");
  return Promise.resolve();
});

console.log(`worker up — waiting for "${SEGMENT_QUEUE}" jobs`);

let stopping = false;
async function shutdown(sig: string) {
  if (stopping) return;
  stopping = true;
  console.log(`${sig}: stopping…`);
  await boss.stop({ graceful: true, timeout: 10_000 });
  await db.close();
  process.exit(0);
}
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => void shutdown(sig));
}
