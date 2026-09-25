import { z } from "zod";
import { env } from "@/lib/env";
import type { Tags } from "../../../../doc";
import { qobuz, QobuzError } from "../../../../qobuz";
import { adoptTrack, keepTrack, pickedOf, trackHeld, trackPlayback } from "../../../../show-store";

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
 * GET ?playback=1 — an expiring URL for native, range-capable playback straight from storage.
 * Without the query, redirect for direct links. Signed answers must never be cached.
 * Playback never touches Qobuz.
 */

type Route = RouteContext<"/api/sessions/[id]/slots/[seq]/track">;

const where = async (ctx: Route) => {
  const p = await ctx.params;
  const seq = Number(p.seq);
  return { ok: z.uuid().safeParse(p.id).success && Number.isInteger(seq) && seq >= 1, id: p.id, seq };
};

/** The slot's pick with its tags, or why there is none. */
async function pickOf(id: string, seq: number): Promise<Tags | { status: number; error: string }> {
  const slot = await pickedOf(id, seq);
  if (!slot) return { status: 404, error: "unknown slot" };
  if (slot.pickId === null) return { status: 409, error: `slot ${seq} is not written yet` };
  const pick = slot.hits.find((h) => h.id === slot.pickId);
  if (!pick) return { status: 500, error: `slot ${seq} picked ${slot.pickId}, which is not one of its hits` };
  return pick;
}

export async function POST(_req: Request, ctx: Route) {
  const w = await where(ctx);
  if (!w.ok) return Response.json({ error: "unknown slot" }, { status: 404 });
  const pick = await pickOf(w.id, w.seq);
  if ("error" in pick) return Response.json({ error: pick.error }, { status: pick.status });
  const tag = `[session ${w.id.slice(0, 8)}] slot ${w.seq}`;
  const name = `${pick.artists.join(", ")} — ${pick.title}`;

  // Idempotent: held returns the tags marked, no pull.
  if (await trackHeld(pick.id)) return Response.json({ held: true, ...pick });

  try {
    const found = await adoptTrack(pick);
    if (found) {
      console.log(`${tag} track held: ${name}, ${found.contentLength ?? "?"} bytes already in the bucket`);
      return Response.json({ held: true, ...pick });
    }
    const e = env();
    const q = qobuz({ token: e.QOBUZ_TOKEN, appId: e.QOBUZ_APP_ID, secret: e.QOBUZ_SECRET });
    const rec = await q.download(pick.id);
    await keepTrack(pick, rec.bytes, rec.mimeType);
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
  const source = await trackPlayback(w.id, w.seq);
  const headers = { "Cache-Control": "private, no-store" };
  if (!source) return Response.json({ error: "no such track" }, { status: 404, headers });
  if (new URL(_req.url).searchParams.get("playback") === "1") return Response.json(source, { headers });
  return new Response(null, { status: 307, headers: { ...headers, Location: source.url } });
}
