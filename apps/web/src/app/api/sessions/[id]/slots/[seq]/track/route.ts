import { z } from "zod";
import { bucket } from "@/lib/bucket";
import { pool } from "@/lib/db";
import { env } from "@/lib/env";
import type { Hit, Tags } from "../../../../doc";
import { qobuz, QobuzError } from "../../../../qobuz";

/**
 * POST /api/sessions/:id/slots/:seq/track — the slot's pick, held: the track is addressed through
 * the slot that picked it (the slot is the proof the station wants this song), but the row and
 * the key are the library's (`track.id`, `tracks/<qobuz id>.mp3`), shared by every session after.
 * A `track` row exists → held already, no Qobuz call. Else the bucket is asked (HEAD): bytes with
 * no row (a crash between the PUT and the insert, or the row wiped) → the row is rebuilt from the
 * pick's tags, no download. Else the pull: Qobuz MP3 320, PUT, then the row — bucket first, row
 * second, so a row always points at media. Not under the session lock: the browser fires this
 * the moment the pick is known while the slot rung is still voicing; two pulls of the same track
 * at once cost one duplicate download and land the same bytes under the same key. No body.
 *
 * GET — the track's bytes, streamed from the bucket. A key is written once, so the answer is
 * immutable and the browser caches it for good. Playback never touches Qobuz.
 */

const audioKeyOf = (trackId: string) => `tracks/${trackId}.mp3`;

type Route = RouteContext<"/api/sessions/[id]/slots/[seq]/track">;

const where = async (ctx: Route) => {
  const p = await ctx.params;
  const seq = Number(p.seq);
  return { ok: z.uuid().safeParse(p.id).success && Number.isInteger(seq) && seq >= 1, id: p.id, seq };
};

/** The slot's pick with its tags, or why there is none. */
async function pickOf(id: string, seq: number): Promise<Tags | { status: number; error: string }> {
  const { rows } = await pool().query<{ qobuz_id: string | null; hits: Hit[] }>(
    "select qobuz_id, hits from session_slot where session_id = $1 and seq = $2",
    [id, seq],
  );
  const slot = rows[0];
  if (!slot) return { status: 404, error: "unknown slot" };
  if (slot.qobuz_id === null) return { status: 409, error: `slot ${seq} is not written yet` };
  const pick = slot.hits.find((h) => h.id === slot.qobuz_id);
  if (!pick)
    return { status: 500, error: `slot ${seq} picked ${slot.qobuz_id}, which is not one of its hits` };
  return pick;
}

async function insertTrack(pick: Tags, key: string, bytes: number): Promise<void> {
  await pool().query(
    `insert into track (id, title, artists, album, image, duration_ms, audio_key, bytes)
     values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (id) do nothing`,
    [pick.id, pick.title, JSON.stringify(pick.artists), pick.album, pick.image, pick.durationMs, key, bytes],
  );
}

export async function POST(_req: Request, ctx: Route) {
  const w = await where(ctx);
  if (!w.ok) return Response.json({ error: "unknown slot" }, { status: 404 });
  const store = bucket();
  if (!store)
    return Response.json({ error: "the clips bucket is not configured (BUCKET_*)" }, { status: 503 });
  const pick = await pickOf(w.id, w.seq);
  if ("error" in pick) return Response.json({ error: pick.error }, { status: pick.status });
  const tag = `[session ${w.id.slice(0, 8)}] slot ${w.seq}`;
  const name = `${pick.artists.join(", ")} — ${pick.title}`;

  // Idempotent: held returns the tags marked, no pull.
  const { rows: held } = await pool().query("select 1 from track where id = $1", [pick.id]);
  if (held.length) return Response.json({ held: true, ...pick });

  try {
    const key = audioKeyOf(pick.id);
    const found = await store.head(key);
    if (found) {
      await insertTrack(pick, key, found.contentLength ?? 0);
      console.log(`${tag} track held: ${name}, ${found.contentLength ?? "?"} bytes already in the bucket`);
      return Response.json({ held: true, ...pick });
    }
    const e = env();
    const q = qobuz({ token: e.QOBUZ_TOKEN, appId: e.QOBUZ_APP_ID, secret: e.QOBUZ_SECRET });
    const rec = await q.download(pick.id);
    await store.put(key, rec.bytes, rec.mimeType);
    await insertTrack(pick, key, rec.bytes.byteLength);
    console.log(`${tag} track held: ${name}, ${rec.bytes.byteLength} bytes`);
    return Response.json({ held: true, ...pick });
  } catch (err) {
    const message =
      err instanceof QobuzError
        ? `${err.message}: ${err.body.slice(0, 200)}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.warn(`${tag} track pull failed: ${message}`);
    return Response.json({ error: message }, { status: 502 });
  }
}

export async function GET(_req: Request, ctx: Route) {
  const w = await where(ctx);
  if (!w.ok) return Response.json({ error: "no such track" }, { status: 404 });
  const store = bucket();
  if (!store)
    return Response.json({ error: "the clips bucket is not configured (BUCKET_*)" }, { status: 503 });
  const pick = await pickOf(w.id, w.seq);
  if ("error" in pick) return Response.json({ error: "no such track" }, { status: 404 });
  const { rows } = await pool().query<{ audio_key: string }>("select audio_key from track where id = $1", [
    pick.id,
  ]);
  const key = rows[0]?.audio_key;
  if (!key) return Response.json({ error: "no such track" }, { status: 404 });
  const obj = await store.open(key);
  if (!obj) return Response.json({ error: "no such track" }, { status: 404 });
  const headers: Record<string, string> = {
    "Content-Type": "audio/mpeg",
    "Cache-Control": "public, max-age=31536000, immutable",
  };
  if (obj.contentLength !== null) headers["Content-Length"] = String(obj.contentLength);
  return new Response(obj.body, { headers });
}
