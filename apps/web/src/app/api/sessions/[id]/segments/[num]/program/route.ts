import { z } from "zod";
import { pool } from "@/lib/db";
import { loadIdentity, loadVoices } from "@/lib/settings";
import { ensureCards } from "../../../../cards";
import { SLOT_COLUMNS, SLOT_FROM, type SlotRow, slotDoc } from "../../../../doc";
import { fetchHeadlines, headlinesText } from "../../../../headlines";
import { clockOf, legalIdOf, produceProgram, type ProgramTrack } from "../../../../program";
import { fetchWeather, WEATHER_PLACE, weatherText } from "../../../../weather";

/**
 * POST /api/sessions/:id/segments/:num/program — one rung, idempotent: ensure this segment's
 * program exists and return the segment document with its slots, none voiced. Already
 * programmed returns the kept rows instantly; no playlist yet is 409. Otherwise, under the
 * session lock: the cards (the table first, the missing ones made now, all at once), one Claude
 * call for every slot, the clock rules, then every session_slot row inserted in one transaction
 * with the writer's raw output kept on the segment as telemetry. The response is the product.
 *
 * Body is optional: `{ clockMs }` — the browser's clock as ms since local midnight, so the DJ
 * knows the time where the listener is; absent, the server's own clock stands in.
 */

const Body = z.object({ clockMs: z.number().int().min(0).max(86_400_000).optional() });

interface SegmentRow {
  id: string;
  tracks: ProgramTrack[] | null;
}

const LOCK_NOT_AVAILABLE = "55P03";

const localClockMs = () => {
  const now = new Date();
  return now.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
};

/** A pull for the brief — the weather, the headlines; a failure is logged and the segment goes on without it. */
const forBrief = async (
  sessionId: string,
  what: string,
  pull: () => Promise<string>,
): Promise<string | null> => {
  try {
    return await pull();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[session ${sessionId.slice(0, 8)}] ${what} pull failed, writing without it: ${message}`);
    return null;
  }
};

export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[id]/segments/[num]/program">) {
  const { id, num } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "unknown session" }, { status: 404 });
  const n = Number(num);
  if (!Number.isInteger(n) || n < 1) return Response.json({ error: "unknown segment" }, { status: 404 });
  const text = await req.text();
  let body: unknown = {};
  if (text.trim() !== "") {
    try {
      body = JSON.parse(text);
    } catch {
      return Response.json({ error: "body is not JSON" }, { status: 400 });
    }
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });

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
    const { rows: segs } = await client.query<SegmentRow>(
      "select id, tracks from session_segment where session_id = $1 and num = $2",
      [id, n],
    );
    if (!segs.length) {
      await client.query("rollback");
      return Response.json({ error: "unknown segment" }, { status: 404 });
    }
    const seg = segs[0];
    if (!seg.tracks) {
      await client.query("rollback");
      return Response.json({ error: "segment has no playlist yet" }, { status: 409 });
    }

    // Idempotent: already programmed returns the kept rows, no production.
    const { rows: kept } = await client.query<SlotRow>(
      `select ${SLOT_COLUMNS} from ${SLOT_FROM} where s.segment_id = $1 order by s.seq`,
      [seg.id],
    );
    if (kept.length) {
      await client.query("rollback");
      return Response.json({ num: n, status: "programmed", slots: kept.map(slotDoc) });
    }

    const [identity, voices, weather, headlines] = await Promise.all([
      loadIdentity(),
      loadVoices(),
      forBrief(id, "weather", async () => weatherText(await fetchWeather(), WEATHER_PLACE.timeZone)),
      forBrief(id, "headlines", async () => headlinesText(await fetchHeadlines(), WEATHER_PLACE.city)),
    ]);
    const dj = voices.find((v) => v.id === session.voice_id)?.name ?? null;
    const carded = await ensureCards(seg.tracks);
    const made = await produceProgram({
      prompt: session.prompt,
      dj,
      identity,
      clock: clockOf(parsed.data.clockMs ?? localClockMs()),
      tracks: seg.tracks,
      cards: carded.cards,
      // Segment 1 is the opening; the hour turning between segments is the next rung's business.
      legalId: n === 1 ? legalIdOf(identity) : null,
      weather,
      headlines,
    });

    for (const s of made.slots)
      await client.query(
        `insert into session_slot (segment_id, seq, track_id, kind, words, lead_line, legal_id, why, fallback, record_under_ms, voice_in_ms)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          seg.id,
          s.seq,
          s.trackId,
          s.kind,
          s.words,
          s.leadLine,
          s.legalId,
          s.why,
          s.fallback ? JSON.stringify(s.fallback) : null,
          s.recordUnderMs,
          s.voiceInMs,
        ],
      );
    await client.query("update session_segment set program = $1 where id = $2", [
      JSON.stringify({ raw: made.raw, cardsMade: carded.made, cardsMissing: carded.missing }),
      seg.id,
    ]);
    const { rows } = await client.query<SlotRow>(
      `select ${SLOT_COLUMNS} from ${SLOT_FROM} where s.segment_id = $1 order by s.seq`,
      [seg.id],
    );
    await client.query("commit");
    const kinds = made.slots.map((s) => s.kind).join(", ");
    console.log(
      `[session ${id.slice(0, 8)}] segment ${n} programmed: ${kinds} (${carded.made.length} cards made, ${carded.missing.length} missing)`,
    );
    return Response.json({ num: n, status: "programmed", slots: rows.map(slotDoc) });
  } catch (err) {
    await client.query("rollback");
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[sessions] segment ${n} program failed: ${message}`);
    return Response.json({ error: message }, { status: 502 });
  } finally {
    client.release();
  }
}
