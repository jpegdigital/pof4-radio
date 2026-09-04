import type { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "@/lib/db";
import { env } from "@/lib/env";
import { trackDocs } from "../../../../doc";
import { Knobs } from "../../../../params";
import { PlaylistError, producePlaylist } from "../../../../playlist";
import { qobuz } from "../../../../qobuz";

/**
 * POST /api/sessions/:id/segments/:num/playlist — one rung, idempotent: ensure this segment's
 * playlist exists and return the segment document. Already playlisted returns the kept row
 * instantly; otherwise the pipeline runs inside the request (the response is the product, no
 * polling). The session row is locked nowait for the duration — a second producer gets 409.
 * Body is optional: a partial Knobs object as a debugging pass-through; the knobs are global
 * defaults otherwise (they belong to the station later, not the session).
 */

interface SegmentRow {
  id: string;
  rationale: string | null;
  tracks: { id: string }[] | null;
  dropped: unknown;
}

const LOCK_NOT_AVAILABLE = "55P03";

/** Which of these records the bucket holds already (pulled for an earlier session). */
async function heldOf(client: PoolClient, tracks: { id: string }[]): Promise<Set<string>> {
  const { rows } = await client.query<{ id: string }>("select id from track where id = any($1::text[])", [
    tracks.map((t) => t.id),
  ]);
  return new Set(rows.map((r) => r.id));
}

export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[id]/segments/[num]/playlist">) {
  const { id, num } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "unknown session" }, { status: 404 });
  const n = Number(num);
  if (!Number.isInteger(n) || n < 1) return Response.json({ error: "unknown segment" }, { status: 404 });
  const body = await req.text();
  let override: unknown = {};
  if (body.trim() !== "") {
    try {
      override = JSON.parse(body);
    } catch {
      return Response.json({ error: "body is not JSON" }, { status: 400 });
    }
  }
  const knobsParsed = Knobs.safeParse(override);
  if (!knobsParsed.success)
    return Response.json({ error: z.prettifyError(knobsParsed.error) }, { status: 400 });

  const client = await pool().connect();
  try {
    await client.query("begin");
    let session: { prompt: string } | undefined;
    try {
      const { rows } = await client.query<{ prompt: string }>(
        "select prompt from session where id = $1 for update nowait",
        [id],
      );
      session = rows[0];
    } catch (err) {
      if (err instanceof Error && "code" in err && err.code === LOCK_NOT_AVAILABLE) {
        await client.query("rollback");
        return Response.json({ error: "session is already producing" }, { status: 409 });
      }
      throw err;
    }
    if (!session) {
      await client.query("rollback");
      return Response.json({ error: "unknown session" }, { status: 404 });
    }
    const { rows: segs } = await client.query<SegmentRow>(
      "select id, rationale, tracks, dropped from session_segment where session_id = $1 and num = $2",
      [id, n],
    );
    if (!segs.length) {
      await client.query("rollback");
      return Response.json({ error: "unknown segment" }, { status: 404 });
    }
    const seg = segs[0];

    // Idempotent: already playlisted returns the kept row, no production.
    if (seg.tracks) {
      const tracks = trackDocs(seg.tracks, await heldOf(client, seg.tracks));
      await client.query("rollback");
      return Response.json({
        num: n,
        status: "playlisted",
        rationale: seg.rationale,
        tracks,
        dropped: seg.dropped ?? [],
      });
    }

    const e = env();
    const q = qobuz({ token: e.QOBUZ_TOKEN, appId: e.QOBUZ_APP_ID, secret: e.QOBUZ_SECRET });
    const made = await producePlaylist(q, session.prompt, knobsParsed.data);
    await client.query(
      "update session_segment set rationale = $1, proposed = $2, candidates = $3, tracks = $4, dropped = $5 where id = $6",
      [
        made.rationale,
        JSON.stringify(made.proposed),
        JSON.stringify(made.candidates),
        JSON.stringify(made.tracks),
        JSON.stringify(made.dropped),
        seg.id,
      ],
    );
    const tracks = trackDocs(made.tracks, await heldOf(client, made.tracks));
    await client.query("commit");
    console.log(
      `[session ${id.slice(0, 8)}] segment ${n} playlisted: ${made.tracks.length} kept of ${made.candidates.length} candidates (${made.dropped.length} dropped)`,
    );
    return Response.json({
      num: n,
      status: "playlisted",
      rationale: made.rationale,
      tracks,
      dropped: made.dropped,
    });
  } catch (err) {
    await client.query("rollback");
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[sessions] segment ${n} playlist failed: ${message}`);
    const dropped = err instanceof PlaylistError ? err.dropped : [];
    return Response.json({ error: message, dropped }, { status: 502 });
  } finally {
    client.release();
  }
}
