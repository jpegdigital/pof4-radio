import { z } from "zod";
import { bucket } from "@/lib/bucket";
import { pool } from "@/lib/db";
import { env } from "@/lib/env";
import type { TrackDoc } from "../../../../../../doc";
import { qobuz, QobuzError } from "../../../../../../qobuz";

/**
 * POST /api/sessions/:id/segments/:num/tracks/:seq/audio — one record, idempotent: the segment's
 * tracks[seq - 1] pulled from Qobuz as MP3 320, PUT to the bucket at `tracks/<qobuz id>.mp3`, then
 * the `track` row inserted — bucket first, row second, so a row always points at media. Held
 * already (a row exists, whichever session pulled it) returns at once with no Qobuz call; no
 * playlist yet is 409. Not under the session lock: the record is the library's, not the
 * session's, and the deck pulls it while the audio rung is voicing the slot — two pulls of the
 * same record at once cost one duplicate download and land the same bytes under the same key.
 *
 * GET — the record's bytes, streamed from the bucket. A key is written once, so the answer is
 * immutable and the browser caches it for good. Playback never touches Qobuz.
 */

const audioKeyOf = (trackId: string) => `tracks/${trackId}.mp3`;

const where = (id: string, num: number, seq: number) => ({
  ok:
    z.uuid().safeParse(id).success && Number.isInteger(num) && num >= 1 && Number.isInteger(seq) && seq >= 1,
  id,
  num,
  seq,
});

type Route = RouteContext<"/api/sessions/[id]/segments/[num]/tracks/[seq]/audio">;

/** The record as the playlist stored it. */
type Stored = Omit<TrackDoc, "recorded">;

/** The segment's tracks[seq - 1], or why there is none. */
async function trackAt(w: {
  id: string;
  num: number;
  seq: number;
}): Promise<Stored | { status: number; error: string }> {
  const { rows } = await pool().query<{ tracks: Stored[] | null }>(
    "select tracks from session_segment where session_id = $1 and num = $2",
    [w.id, w.num],
  );
  if (!rows.length) return { status: 404, error: "unknown segment" };
  if (!rows[0].tracks) return { status: 409, error: "segment has no playlist yet" };
  return rows[0].tracks[w.seq - 1] ?? { status: 404, error: "unknown track" };
}

export async function POST(_req: Request, ctx: Route) {
  const p = await ctx.params;
  const w = where(p.id, Number(p.num), Number(p.seq));
  if (!w.ok) return Response.json({ error: "unknown track" }, { status: 404 });
  const store = bucket();
  if (!store)
    return Response.json({ error: "the clips bucket is not configured (BUCKET_*)" }, { status: 503 });
  const track = await trackAt(w);
  if ("error" in track) return Response.json({ error: track.error }, { status: track.status });

  // Idempotent: held returns the record marked, no pull.
  const { rows: held } = await pool().query("select 1 from track where id = $1", [track.id]);
  if (held.length) return Response.json({ ...track, recorded: true } satisfies TrackDoc);

  try {
    const e = env();
    const q = qobuz({ token: e.QOBUZ_TOKEN, appId: e.QOBUZ_APP_ID, secret: e.QOBUZ_SECRET });
    const rec = await q.download(track.id);
    const key = audioKeyOf(track.id);
    await store.put(key, rec.bytes, rec.mimeType);
    await pool().query(
      "insert into track (id, name, artists, audio_key, bytes) values ($1, $2, $3, $4, $5) on conflict (id) do nothing",
      [track.id, track.name, JSON.stringify(track.artists), key, rec.bytes.byteLength],
    );
    console.log(
      `[session ${w.id.slice(0, 8)}] segment ${w.num} track ${w.seq} recorded: ${track.artists.join(", ")} — ${track.name}, ${rec.bytes.byteLength} bytes`,
    );
    return Response.json({ ...track, recorded: true } satisfies TrackDoc);
  } catch (err) {
    const message =
      err instanceof QobuzError
        ? `${err.message}: ${err.body.slice(0, 200)}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.warn(`[sessions] segment ${w.num} track ${w.seq} record failed: ${message}`);
    return Response.json({ error: message }, { status: 502 });
  }
}

export async function GET(_req: Request, ctx: Route) {
  const p = await ctx.params;
  const w = where(p.id, Number(p.num), Number(p.seq));
  if (!w.ok) return Response.json({ error: "no such record" }, { status: 404 });
  const store = bucket();
  if (!store)
    return Response.json({ error: "the clips bucket is not configured (BUCKET_*)" }, { status: 503 });
  const track = await trackAt(w);
  if ("error" in track) return Response.json({ error: "no such record" }, { status: 404 });
  const { rows } = await pool().query<{ audio_key: string }>("select audio_key from track where id = $1", [
    track.id,
  ]);
  const key = rows[0]?.audio_key;
  if (!key) return Response.json({ error: "no such record" }, { status: 404 });
  const obj = await store.open(key);
  if (!obj) return Response.json({ error: "no such record" }, { status: 404 });
  const headers: Record<string, string> = {
    "Content-Type": "audio/mpeg",
    "Cache-Control": "public, max-age=31536000, immutable",
  };
  if (obj.contentLength !== null) headers["Content-Length"] = String(obj.contentLength);
  return new Response(obj.body, { headers });
}
