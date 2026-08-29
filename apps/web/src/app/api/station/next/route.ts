import type Anthropic from "@anthropic-ai/sdk";
import { buildUserTurn, capHistory, planSegment, trimTurn } from "@radio/dj";
import { z } from "zod";
import { claude } from "@/lib/claude";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { loadPromptTemplate } from "@/lib/prompts";
import { search } from "@/lib/spotify";

/**
 * Plan the next segment: continue the station's DJ conversation by one turn.
 *
 * The browser calls this the moment a segment's talk starts, so the answer (20–60 s) lands
 * while that segment is still playing. The station row is locked for the duration; a second
 * tab gets 409 instead of a second billed run. Nothing runs when nobody calls.
 */
const Body = z.object({
  stationId: z.uuid().nullable(),
  prompt: z.string().trim().min(1).max(500),
  /** The DJ on the mic, by name — fills {dj} in the prompts. */
  dj: z.string().trim().min(1).max(60).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid body" }, { status: 400 });
  const { prompt, dj } = parsed.data;

  const stationId = parsed.data.stationId ?? (await db().createStation(prompt)).id;
  const lock = await db().lockStation(stationId);
  if (lock.status === "missing") return Response.json({ error: "unknown station" }, { status: 404 });
  if (lock.status === "busy") return Response.json({ error: "busy" }, { status: 409 });

  const { station } = lock;
  const tag = `[station ${stationId.slice(0, 8)} #${station.segmentCount + 1}]`;
  let ok = false;
  try {
    const [previous, template] = await Promise.all([db().lastSegment(stationId), loadPromptTemplate()]);
    const userTurn = buildUserTurn(template, {
      prompt,
      dj,
      previous: previous ? { talk: previous.talk, tracks: previous.tracks } : null,
      promptChanged: previous !== null && prompt !== station.prompt,
    });
    const model = env().CLAUDE_MODEL;
    const out = await planSegment(
      {
        system: template["prompt.system"],
        history: station.messages as Anthropic.MessageParam[],
        userTurn,
      },
      { client: claude(), model, search },
    );
    const messages = capHistory([...(station.messages as Anthropic.MessageParam[]), ...trimTurn(out.turn)]);
    const segment = await lock.commit({ prompt, messages, talk: out.talk, tracks: out.tracks, model });
    ok = true;
    const u = out.usage;
    console.log(
      `${tag} ready in ${u.requests} calls — in ${u.input} / cached ${u.cacheRead} / cache-write ${u.cacheWrite} / out ${u.output}: ${out.tracks
        .map((t) => `${t.artists[0]} – ${t.name}`)
        .join(" | ")}`,
    );
    return Response.json({
      stationId,
      segment: {
        id: segment.id,
        seq: segment.seq,
        prompt: segment.prompt,
        talk: segment.talk,
        tracks: segment.tracks,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${tag} failed: ${message}`);
    return Response.json({ error: message, stationId }, { status: 502 });
  } finally {
    await lock.release(ok);
  }
}
