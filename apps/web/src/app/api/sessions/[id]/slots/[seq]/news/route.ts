import { z } from "zod";
import { recordHeard } from "../../../../show-store";

const Exposure = z.object({ clipKey: z.string().min(1).max(250) });
/** Heard receipts are separate from generation reservations; the server owns the selected IDs. */
export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[id]/slots/[seq]/news">) {
  const { id, seq: raw } = await ctx.params;
  const seq = Number(raw);
  if (!z.uuid().safeParse(id).success || !Number.isInteger(seq) || seq < 1)
    return Response.json({ error: "unknown slot" }, { status: 404 });
  const parsed = Exposure.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid news receipt" }, { status: 400 });
  return Response.json({ recorded: await recordHeard(id, seq, parsed.data.clipKey) });
}
