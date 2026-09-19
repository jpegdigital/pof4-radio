import { z } from "zod";
import { pool } from "@/lib/db";

const Exposure = z.object({ clipKey: z.string().min(1).max(250) });
/** Heard receipts are separate from generation reservations; the server owns the selected IDs. */
export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[id]/slots/[seq]/news">) {
  const { id, seq: raw } = await ctx.params;
  const seq = Number(raw);
  if (!z.uuid().safeParse(id).success || !Number.isInteger(seq) || seq < 1)
    return Response.json({ error: "unknown slot" }, { status: 404 });
  const parsed = Exposure.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid news receipt" }, { status: 400 });
  const { rowCount } = await pool().query(
    `insert into session_news_exposure (session_id, seq, clip_key, story_id, revision)
     select s.session_id, s.seq, s.clip_key, story->>'storyId', story->>'revision'
     from session_slot s cross join lateral jsonb_array_elements(
       coalesce(s.news->'stories', '[]'::jsonb)
     ) story
     where s.session_id = $1 and s.seq = $2 and s.clip_key = $3 and s.news->>'words' is not null
       and story->>'storyId' is not null and story->>'revision' is not null
     on conflict do nothing`,
    [id, seq, parsed.data.clipKey],
  );
  return Response.json({ recorded: Boolean(rowCount) });
}
