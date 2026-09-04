import { z } from "zod";
import { pool } from "@/lib/db";
import { SessionParams } from "./params";

/**
 * POST /api/sessions — creation only, instant: the ask and the voice become a session row. No
 * slot, no model call, no Qobuz, nothing to error-recover; production starts with /fill once
 * the client lands on /sessions/:id.
 */

export async function POST(req: Request) {
  const parsed = SessionParams.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  const { prompt, voiceId } = parsed.data;
  try {
    const { rows } = await pool().query<{ id: string }>(
      "insert into session (prompt, voice_id) values ($1, $2) returning id",
      [prompt, voiceId],
    );
    const sessionId = rows[0].id;
    console.log(`[session ${sessionId.slice(0, 8)}] opened: ${prompt}`);
    return Response.json({ sessionId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[sessions] open failed: ${message}`);
    return Response.json({ error: message }, { status: 502 });
  }
}
