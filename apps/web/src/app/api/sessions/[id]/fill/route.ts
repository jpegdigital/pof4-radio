import { z } from "zod";
import { pool } from "@/lib/db";
import { env } from "@/lib/env";
import { loadClock, loadIdentity, loadVoices } from "@/lib/settings";
import { SLOT_COLUMNS, type SlotRow, slotDoc } from "../../doc";
import { FillError, produceFill } from "../../fill";
import { qobuz } from "../../qobuz";

/**
 * POST /api/sessions/:id/fill — the fill rung: a few more slots for the show. Under the session
 * lock (a second producer gets 409): what has played and what is coming go to the proposer, one
 * Claude call names `clock.fill` + 2 songs, a repeat is dropped, Qobuz search finds each one's
 * versions, and one session_slot per proposal with a hit is appended, in order, in one
 * transaction. The response is the product: the new rows and one line per proposal that did not
 * become a slot. Nothing added is 502 with the reasons. No body.
 */

const LOCK_NOT_AVAILABLE = "55P03";
const NONE_HELD: ReadonlySet<string> = new Set();

interface Existing {
  seq: number;
  title: string;
  artist: string;
  qobuz_id: string | null;
}

export async function POST(_req: Request, ctx: RouteContext<"/api/sessions/[id]/fill">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "unknown session" }, { status: 404 });
  const tag = `[session ${id.slice(0, 8)}]`;

  const client = await pool().connect();
  try {
    await client.query("begin");
    let session: { prompt: string; voice_id: string } | undefined;
    try {
      const { rows } = await client.query<{ prompt: string; voice_id: string }>(
        "select prompt, voice_id from session where id = $1 for update nowait",
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

    const [clock, identity, voices, { rows: existing }] = await Promise.all([
      loadClock(),
      loadIdentity(),
      loadVoices(),
      client.query<Existing>(
        "select seq, title, artist, qobuz_id from session_slot where session_id = $1 order by seq",
        [id],
      ),
    ]);
    const dj = voices.find((v) => v.id === session.voice_id)?.name ?? null;
    const e = env();
    const q = qobuz({ token: e.QOBUZ_TOKEN, appId: e.QOBUZ_APP_ID, secret: e.QOBUZ_SECRET });
    const made = await produceFill(q, {
      prompt: session.prompt,
      dj,
      identity,
      played: existing.filter((s) => s.qobuz_id !== null),
      pending: existing.filter((s) => s.qobuz_id === null),
      count: clock.fill,
    });

    const last = existing.at(-1)?.seq ?? 0;
    const added: SlotRow[] = [];
    for (const [i, s] of made.slots.entries()) {
      const { rows } = await client.query<SlotRow>(
        `insert into session_slot (session_id, seq, title, artist, why, hits)
         values ($1, $2, $3, $4, $5, $6) returning ${SLOT_COLUMNS}`,
        [id, last + i + 1, s.title, s.artist, s.why, JSON.stringify(s.hits)],
      );
      added.push(rows[0]);
    }
    await client.query("commit");
    console.log(
      `${tag} fill: ${added.length} slots added (seq ${last + 1}–${last + added.length}), ${made.dropped.length} dropped${made.dropped.length ? `: ${made.dropped.join("; ")}` : ""}`,
    );
    return Response.json({ added: added.map((r) => slotDoc(r, NONE_HELD)), dropped: made.dropped });
  } catch (err) {
    await client.query("rollback");
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${tag} fill failed: ${message}`);
    const dropped = err instanceof FillError ? err.dropped : [];
    return Response.json({ error: message, dropped }, { status: 502 });
  } finally {
    client.release();
  }
}
