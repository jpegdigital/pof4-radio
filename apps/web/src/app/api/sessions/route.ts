import { z } from "zod";
import { claude } from "@/lib/claude";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { search } from "@/lib/spotify";
import { SessionParams } from "./params";
import { type Candidate, selectTracks } from "./select";
import { choicesOf, composeTool, picksOf, proposeTool } from "./tools";

/**
 * POST /api/sessions — one prompt becomes a playlist in three moves, straight through:
 * Claude PROPOSES records by name (leads, not gospel), Spotify search HYDRATES each into real
 * candidate tracks (dumb, keeps everything), Claude COMPOSES the playlist from those candidates
 * by id — it can prefer the live take when the ask wants one, and it cannot invent a track:
 * every id is validated against the pool and joined back to metadata we already hold (select.ts).
 * The hot path is this one function, top to bottom.
 */

// The knobs (propose / candidates / playlist / min) are request parameters — params.ts owns
// the shapes and the defaults; the form posts only what was touched.

// Inline for the stub; moves to the settings table when the prompts start being tuned.
const SYSTEM =
  "You are the music director of a radio station. You know records deeply and you build playlists that answer the listener's ask.";

export async function POST(req: Request) {
  const parsed = SessionParams.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  const { prompt, voiceId, propose, candidates: perPick, playlist, min } = parsed.data;

  try {
    // 1. PROPOSE — names only, wide on purpose: a dropped pick costs nothing now.
    const proposed = await claude().messages.create({
      model: env().CLAUDE_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `The listener's request: ${prompt}\n\nName ${propose} records that could answer it — one per slot, fill every slot.`,
        },
      ],
      tools: [proposeTool(propose)],
      tool_choice: { type: "tool", name: "propose_records" },
    });
    const proposeCall = proposed.content.find((c) => c.type === "tool_use");
    if (!proposeCall || proposeCall.type !== "tool_use")
      return Response.json({ error: `claude proposed nothing (${proposed.stop_reason})` }, { status: 502 });
    const proposeOut = proposeCall.input as { rationale: string } & Record<string, unknown>;
    const picks = picksOf(proposeOut, propose);

    // 2. HYDRATE — dumb search, everything kept; a failed search is an empty hand, logged.
    const settled = await Promise.allSettled(
      picks.map((p) => search(`${p.title} artist:${p.artist}`, perPick)),
    );
    const candidates: Candidate[] = [];
    const dropped: string[] = [];
    settled.forEach((s, i) => {
      const p = picks[i];
      if (s.status !== "fulfilled") {
        console.warn(`[sessions] search failed for ${p.artist} — ${p.title}: ${s.reason}`);
        dropped.push(`search failed for ${p.artist} — ${p.title}`);
        return;
      }
      if (!s.value.length) {
        dropped.push(`no hits for ${p.artist} — ${p.title}`);
        return;
      }
      for (const t of s.value)
        candidates.push({
          id: t.id,
          uri: t.uri,
          name: t.name,
          artists: t.artists,
          album: t.album,
          image: t.images[0]?.url ?? null,
          durationMs: t.durationMs,
          pick: i,
          why: p.why,
        });
    });
    if (!candidates.length)
      return Response.json({ error: "no candidates resolved", dropped }, { status: 502 });

    // 3. COMPOSE — the real catalogue on the table, ids only; selection, not creation.
    const menu = picks
      .map((p, i) => {
        const hits = candidates.filter((c) => c.pick === i);
        if (!hits.length) return null;
        const lines = hits.map(
          (c) =>
            `   ${c.id} | ${c.name} — ${c.artists.join(", ")} | ${c.album} | ${Math.floor(c.durationMs / 60000)}:${String(Math.floor((c.durationMs % 60000) / 1000)).padStart(2, "0")}`,
        );
        return `${i + 1}. ${p.artist} — ${p.title} (${p.why})\n${lines.join("\n")}`;
      })
      .filter(Boolean)
      .join("\n");
    const composed = await claude().messages.create({
      model: env().CLAUDE_MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `The listener's request: ${prompt}\n\nThe catalogue offered these candidates for your proposed records — pick the right version of each worth keeping (the single, the live take, whichever answers the request):\n\n${menu}\n\nCompose the playlist: fill the ${playlist} slots in play order — each slot one candidate id plus why that track belongs in this playlist (a slot's id is "" only if nothing deserves it).`,
        },
      ],
      tools: [composeTool(playlist)],
      tool_choice: { type: "tool", name: "compose_playlist" },
    });
    const composeCall = composed.content.find((c) => c.type === "tool_use");
    if (!composeCall || composeCall.type !== "tool_use")
      return Response.json({ error: `claude composed nothing (${composed.stop_reason})` }, { status: 502 });
    const composeOut = composeCall.input as { rationale: string } & Record<string, unknown>;
    const rationale = composeOut.rationale;
    const choices = choicesOf(composeOut, playlist);

    // 4. VALIDATE & JOIN — pure (select.ts); too few survivors is a failure with receipts.
    const sel = selectTracks(choices, candidates, playlist);
    dropped.push(...sel.dropped);
    const kept = sel.kept;
    if (kept.length < min)
      return Response.json(
        { error: `only ${kept.length} tracks composed (need ${min})`, dropped },
        { status: 502 },
      );

    const { rows } = await db().pool.query<{ id: string }>(
      "insert into session (prompt, voice_id, rationale, proposed, candidates, tracks, dropped) values ($1, $2, $3, $4, $5, $6, $7) returning id",
      [
        prompt,
        voiceId,
        rationale,
        JSON.stringify({ rationale: proposeOut.rationale, picks }),
        JSON.stringify(candidates),
        JSON.stringify(kept),
        JSON.stringify(dropped),
      ],
    );
    const sessionId = rows[0].id;
    console.log(
      `[session ${sessionId.slice(0, 8)}] ${kept.length} kept of ${candidates.length} candidates (${picks.length} picks, ${dropped.length} dropped): ${prompt}`,
    );
    return Response.json({ sessionId, rationale, tracks: kept, dropped });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[sessions] failed: ${message}`);
    return Response.json({ error: message }, { status: 502 });
  }
}
