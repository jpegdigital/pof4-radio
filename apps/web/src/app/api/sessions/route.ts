import { z } from "zod";
import { db } from "@/lib/db";
import { SessionParams } from "./params";

/**
 * POST /api/sessions — creation only, instant: the ask and the voice become a session row plus
 * segment 1 at open, one transaction (a session never exists without its first segment). No
 * model call, no Spotify, nothing to error-recover; production happens on the rungs
 * (/segments/:num/playlist first) once the client lands on /sessions/:id.
 */

export async function POST(req: Request) {
  const parsed = SessionParams.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  const { prompt, voiceId } = parsed.data;

  const client = await db().pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<{ id: string }>(
      "insert into session (prompt, voice_id) values ($1, $2) returning id",
      [prompt, voiceId],
    );
    const sessionId = rows[0].id;
    await client.query("insert into session_segment (session_id, num) values ($1, 1)", [sessionId]);
    await client.query("commit");
    console.log(`[session ${sessionId.slice(0, 8)}] opened: ${prompt}`);
    return Response.json({ sessionId });
  } catch (err) {
    await client.query("rollback");
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[sessions] open failed: ${message}`);
    return Response.json({ error: message }, { status: 502 });
  } finally {
    client.release();
  }
}
