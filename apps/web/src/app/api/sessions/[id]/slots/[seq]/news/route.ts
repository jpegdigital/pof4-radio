import { z } from "zod";
import { pool } from "@/lib/db";

const Exposure = z.object({
  clipKey: z.string().min(1).max(250),
  storyId: z.string().min(1).max(100),
  revision: z.string().min(1).max(100),
});

/** An idempotent receipt for a fully played break; never accepts another slot's take. */
export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[id]/slots/[seq]/news">) {
  const { id, seq: raw } = await ctx.params;
  const seq = Number(raw);
  if (!z.uuid().safeParse(id).success || !Number.isInteger(seq) || seq < 1)
    return Response.json({ error: "unknown slot" }, { status: 404 });
  const parsed = Exposure.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid news receipt" }, { status: 400 });
  const { clipKey, storyId, revision } = parsed.data;
  const { rowCount } = await pool().query(
    `insert into session_news_exposure (session_id, seq, clip_key, story_id, revision)
     select session_id, seq, $3, $4, $5 from session_slot
     where session_id = $1 and seq = $2 and clip_key = $3
       and news->>'storyId' = $4 and news->>'revision' = $5 and news->>'words' is not null
     on conflict do nothing`,
    [id, seq, clipKey, storyId, revision],
  );
  return Response.json({ recorded: Boolean(rowCount) });
}
