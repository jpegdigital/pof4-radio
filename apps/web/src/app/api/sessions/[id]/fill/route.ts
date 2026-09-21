import { z } from "zod";
import { env } from "@/lib/env";
import { loadClock, loadIdentity, loadVoices } from "@/lib/settings";
import { slotDoc } from "../../doc";
import { FillError, produceFill } from "../../fill";
import { qobuz } from "../../qobuz";
import { type LockedShow, lockShow, SessionBusy, UnknownSession } from "../../show-store";

/**
 * POST /api/sessions/:id/fill — the fill rung: a few more slots for the show. Under the session
 * lock (a second producer gets 409): what has played and what is coming go to the proposer, one
 * Claude call names `clock.fill` + 2 songs, a repeat is dropped, Qobuz search finds each one's
 * versions, and one session_slot per proposal with a hit is appended, in order, in one
 * transaction. The response is the product: the new rows and one line per proposal that did not
 * become a slot. Nothing added is 502 with the reasons. No body.
 */

const NONE_HELD: ReadonlySet<string> = new Set();

export async function POST(_req: Request, ctx: RouteContext<"/api/sessions/[id]/fill">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "unknown session" }, { status: 404 });
  const tag = `[session ${id.slice(0, 8)}]`;

  let show: LockedShow | undefined;
  try {
    try {
      show = await lockShow(id);
    } catch (err) {
      if (err instanceof SessionBusy) return Response.json({ error: err.message }, { status: 409 });
      if (err instanceof UnknownSession) return Response.json({ error: err.message }, { status: 404 });
      throw err;
    }
    const { prompt, voiceId } = show;

    const [clock, identity, voices, existing] = await Promise.all([
      loadClock(),
      loadIdentity(),
      loadVoices(),
      show.slots(),
    ]);
    const dj = voices.find((v) => v.id === voiceId)?.name ?? null;
    const e = env();
    const q = qobuz({ token: e.QOBUZ_TOKEN, appId: e.QOBUZ_APP_ID, secret: e.QOBUZ_SECRET });
    const made = await produceFill(q, {
      prompt,
      dj,
      identity,
      played: existing.filter((s) => s.qobuz_id !== null),
      pending: existing.filter((s) => s.qobuz_id === null),
      count: clock.fill,
    });

    const last = existing.at(-1)?.seq ?? 0;
    const added = await show.append(last, made.slots);
    await show.commit();
    console.log(
      `${tag} fill: ${added.length} slots added (seq ${last + 1}–${last + added.length}), ${made.dropped.length} dropped${made.dropped.length ? `: ${made.dropped.join("; ")}` : ""}`,
    );
    return Response.json({ added: added.map((r) => slotDoc(r, NONE_HELD)), dropped: made.dropped });
  } catch (err) {
    if (show) await show.rollback();
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${tag} fill failed: ${message}`);
    const dropped = err instanceof FillError ? err.dropped : [];
    return Response.json({ error: message, dropped }, { status: 502 });
  } finally {
    show?.release();
  }
}
