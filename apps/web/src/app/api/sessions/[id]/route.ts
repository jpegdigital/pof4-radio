import { z } from "zod";
import { loadClock } from "@/lib/settings";
import { slotDoc } from "../doc";
import { heldAmong, sessionOf, slotsOf } from "../show-store";

/**
 * GET /api/sessions/:id — the session as stored, a snapshot that never produces anything: the
 * ask, the clock (so the browser knows the low-water mark), then every slot in order, each
 * carrying whatever its production has landed so far — the proposal, then the pick with its
 * tags and whether the bucket holds it, the chart, the copy, the timing, then the clip key —
 * status derived from presence (doc.ts), never audio, never the receipts. no-store while the
 * document can still grow. A missing clock row is a 500 naming it.
 */

export async function GET(_req: Request, ctx: RouteContext<"/api/sessions/[id]">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "unknown session" }, { status: 404 });
  const s = await sessionOf(id);
  if (!s) return Response.json({ error: "unknown session" }, { status: 404 });
  try {
    const [clock, slots] = await Promise.all([loadClock(), slotsOf(id)]);
    // Which of the session's picks the bucket holds — one query across every slot.
    const holds = await heldAmong(slots.map((r) => r.qobuz_id).filter((x): x is string => x !== null));
    return Response.json(
      {
        sessionId: s.id,
        prompt: s.prompt,
        voiceId: s.voiceId,
        createdAt: s.createdAt.toISOString(),
        clock,
        slots: slots.map((r) => slotDoc(r, holds)),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[session ${id.slice(0, 8)}] snapshot failed: ${message}`);
    return Response.json({ error: message }, { status: 500 });
  }
}
