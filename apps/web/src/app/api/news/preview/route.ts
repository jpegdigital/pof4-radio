import { z } from "zod";
import { pool } from "@/lib/db";
import { claude } from "@/lib/claude";
import { env } from "@/lib/env";
import { loadNews } from "@/lib/settings";
import { editHeadlines } from "../../sessions/headline-edit";
import { readHeadlines, type HeadlineSnapshot } from "../../sessions/headlines";

const Preview = z.object({
  refresh: z.boolean().optional(),
  snapshotId: z.uuid().optional(),
  prompt: z.string().max(500).default("An evening in Dallas with good music"),
  track: z.string().max(200).default("The next record"),
});

/** Guarded control-room trial. Saved snapshots can be compared without pulling again or voicing. */
export async function POST(req: Request) {
  const parsed = Preview.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid preview request" }, { status: 400 });
  try {
    const config = await loadNews();
    let snapshot: HeadlineSnapshot;
    if (parsed.data.snapshotId) {
      const { rows } = await pool().query<{ snapshot: HeadlineSnapshot }>(
        "select snapshot from headline_snapshot where id = $1",
        [parsed.data.snapshotId],
      );
      if (!rows[0]) return Response.json({ error: "Snapshot not found" }, { status: 404 });
      snapshot = { ...rows[0].snapshot, id: crypto.randomUUID(), config };
    } else snapshot = await readHeadlines(config, { refresh: parsed.data.refresh });
    const result = await editHeadlines(snapshot, [], parsed.data.prompt, parsed.data.track, {
      client: claude(),
      model: env().CLAUDE_MODEL,
    });
    await pool().query("insert into headline_snapshot (id, snapshot, audit) values ($1, $2, $3)", [
      snapshot.id,
      JSON.stringify(snapshot),
      JSON.stringify(result.audit),
    ]);
    return Response.json({ snapshot, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.warn("[news] preview failed:", err);
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
