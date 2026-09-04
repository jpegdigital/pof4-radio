import { z } from "zod";
import { bucket } from "@/lib/bucket";
import { pool } from "@/lib/db";
import { env } from "@/lib/env";
import { loadVoices } from "@/lib/settings";
import { ttsBody } from "@/lib/voices";
import { SLOT_COLUMNS, SLOT_FROM, type SlotRow, slotDoc } from "../../../../../../doc";

/**
 * POST /api/sessions/:id/segments/:num/slots/:seq/audio — one clip, idempotent: the slot's
 * spoken text (legal ID, words, lead line, in that order) through ElevenLabs in the session's
 * voice, PUT to the bucket, then the row stamped — clip_key only once the bytes exist. Voiced
 * already returns the kept row; a segue has nothing to say and is stamped voiced with no clip;
 * no program yet is 409. No timestamps, no alignment: the player reads the clip's length when
 * it loads it, and the mix is the writer's two numbers plus house constants.
 *
 * A body of `{ again: true }` voices a voiced slot once more, with the roster as it stands now
 * (the voice's model, speed, the lot): a new take under a new key, the old bytes kept in the
 * bucket, the row moved to the new one. The words never change — only the reading.
 *
 * GET — the clip's bytes, streamed from the bucket. A key is written once, so the answer is
 * immutable and the browser caches it for good.
 */

const LOCK_NOT_AVAILABLE = "55P03";

const Body = z.object({ again: z.boolean().optional() });

/** The first take is `<seq>.mp3`; every take after carries when it was made, so no two keys collide. */
const clipKeyOf = (sessionId: string, num: number, seq: number, take: string | null) =>
  `sessions/${sessionId}/${num}/${seq}${take ? `-${take}` : ""}.mp3`;

const where = (id: string, num: number, seq: number) => ({
  ok:
    z.uuid().safeParse(id).success && Number.isInteger(num) && num >= 1 && Number.isInteger(seq) && seq >= 1,
  id,
  num,
  seq,
});

type Route = RouteContext<"/api/sessions/[id]/segments/[num]/slots/[seq]/audio">;

export async function POST(req: Request, ctx: Route) {
  const p = await ctx.params;
  const w = where(p.id, Number(p.num), Number(p.seq));
  if (!w.ok) return Response.json({ error: "unknown slot" }, { status: 404 });
  const text = await req.text();
  let again = false;
  if (text.trim() !== "") {
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return Response.json({ error: "body is not JSON" }, { status: 400 });
    }
    const parsed = Body.safeParse(body);
    if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
    again = parsed.data.again ?? false;
  }
  const store = bucket();
  if (!store)
    return Response.json({ error: "the clips bucket is not configured (BUCKET_*)" }, { status: 503 });
  const key = env().ELEVENLABS_KEY;
  if (!key) return Response.json({ error: "ELEVENLABS_KEY is not set on the server" }, { status: 503 });

  const client = await pool().connect();
  try {
    await client.query("begin");
    let session: { voice_id: string } | undefined;
    try {
      const { rows } = await client.query<{ voice_id: string }>(
        "select voice_id from session where id = $1 for update nowait",
        [w.id],
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
    const { rows: segs } = await client.query<{ id: string }>(
      "select id from session_segment where session_id = $1 and num = $2",
      [w.id, w.num],
    );
    const seg = segs[0];
    if (!seg) {
      await client.query("rollback");
      return Response.json({ error: "unknown segment" }, { status: 404 });
    }
    const { rows: slots } = await client.query<SlotRow & { id: string }>(
      `select s.id, ${SLOT_COLUMNS} from ${SLOT_FROM} where s.segment_id = $1 and s.seq = $2`,
      [seg.id, w.seq],
    );
    const slot = slots[0];
    if (!slot) {
      const { rows: any } = await client.query("select 1 from session_slot where segment_id = $1 limit 1", [
        seg.id,
      ]);
      await client.query("rollback");
      return any.length
        ? Response.json({ error: "unknown slot" }, { status: 404 })
        : Response.json({ error: "segment has no program yet" }, { status: 409 });
    }

    // Idempotent: voiced returns the kept row, no production — unless asked for another take of something said.
    if (slot.voiced_at && !(again && slot.words)) {
      await client.query("rollback");
      return Response.json(slotDoc(slot));
    }

    // Nothing to say: done, silent.
    if (!slot.words) {
      const { rows } = await client.query<SlotRow>(
        `update session_slot set voiced_at = now() where id = $1 returning ${SLOT_COLUMNS.replace("c.intro_ms", "$2::integer as intro_ms")}`,
        [slot.id, slot.intro_ms],
      );
      await client.query("commit");
      return Response.json(slotDoc(rows[0]));
    }

    const voices = await loadVoices();
    const voice = voices.find((v) => v.id === session.voice_id) ?? voices[0];
    if (!voice) throw new Error("no voice on the roster (settings.voices)");
    const said = [slot.legal_id, slot.words, slot.lead_line].filter(Boolean).join(" ");
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice.id)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify(ttsBody(voice, said)),
      },
    );
    if (!res.ok)
      throw new Error(`elevenlabs ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const clipKey = clipKeyOf(w.id, w.num, w.seq, slot.voiced_at ? Date.now().toString(36) : null);
    await store.put(clipKey, bytes, "audio/mpeg");
    const { rows } = await client.query<SlotRow>(
      `update session_slot set clip_key = $2, voiced_at = now() where id = $1 returning ${SLOT_COLUMNS.replace("c.intro_ms", "$3::integer as intro_ms")}`,
      [slot.id, clipKey, slot.intro_ms],
    );
    await client.query("commit");
    console.log(
      `[session ${w.id.slice(0, 8)}] segment ${w.num} slot ${w.seq} voiced${slot.voiced_at ? " again" : ""}: ${slot.kind}, ${said.length} chars, ${bytes.byteLength} bytes`,
    );
    return Response.json(slotDoc(rows[0]));
  } catch (err) {
    await client.query("rollback");
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[sessions] segment ${w.num} slot ${w.seq} audio failed: ${message}`);
    return Response.json({ error: message }, { status: 502 });
  } finally {
    client.release();
  }
}

export async function GET(_req: Request, ctx: Route) {
  const p = await ctx.params;
  const w = where(p.id, Number(p.num), Number(p.seq));
  if (!w.ok) return Response.json({ error: "no such clip" }, { status: 404 });
  const store = bucket();
  if (!store)
    return Response.json({ error: "the clips bucket is not configured (BUCKET_*)" }, { status: 503 });
  const { rows } = await pool().query<{ clip_key: string | null }>(
    `select s.clip_key from session_slot s join session_segment g on g.id = s.segment_id
     where g.session_id = $1 and g.num = $2 and s.seq = $3`,
    [w.id, w.num, w.seq],
  );
  const clipKey = rows[0]?.clip_key;
  if (!clipKey) return Response.json({ error: "no such clip" }, { status: 404 });
  const obj = await store.open(clipKey);
  if (!obj) return Response.json({ error: "no such clip" }, { status: 404 });
  const headers: Record<string, string> = {
    "Content-Type": "audio/mpeg",
    "Cache-Control": "public, max-age=31536000, immutable",
  };
  if (obj.contentLength !== null) headers["Content-Length"] = String(obj.contentLength);
  return new Response(obj.body, { headers });
}
