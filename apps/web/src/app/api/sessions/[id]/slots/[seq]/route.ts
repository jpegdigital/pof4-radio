import { z } from "zod";
import { bucket } from "@/lib/bucket";
import { pool } from "@/lib/db";
import { speak } from "@/lib/elevenlabs";
import { env } from "@/lib/env";
import { loadClock, loadIdentity, loadNews, loadVoices } from "@/lib/settings";
import type { NewsReceipt } from "@/lib/news";
import { readPreparedNews, readPreparedWeather } from "@/lib/prepared";
import { SLOT_COLUMNS, type SlotRow, slotDoc } from "../../../doc";
import { chooseHeadlines, type HeadlineHistory } from "../../../headline-choice";
import type { SlotGeneration } from "../../../generation";
import { producePick } from "../../../pick";
import { producePlan } from "../../../planning";
import { SlotBody } from "../../../params";
import { checkSlot, isBreak, legalIdDue } from "../../../rules";
import { clockOf, legalIdOf, produceWrite, type WriteInput } from "../../../write";

/** One retained pipeline: DB facts -> Jev choices/plan -> one Claude script -> one TTS.
 * Session row locking serializes reservations. A savepoint retains all prepared decisions on a
 * writer failure; a voice failure retains the script too. Retries never research or reselect.
 * Playback uses the saved production. Generation inputs and every take remain retained.
 */

const LOCK_NOT_AVAILABLE = "55P03";

const RECENT_SLOTS = 3;

const clipKeyOf = (id: string, seq: number, take: string | null) =>
  `sessions/${id}/${seq}${take ? `-${take}` : ""}.mp3`;

interface RecentRow {
  seq: number;
  kind: string;
  words: string | null;
  lead_line: string | null;
  title: string;
  artist: string;
}

type Route = RouteContext<"/api/sessions/[id]/slots/[seq]">;

export async function POST(req: Request, ctx: Route) {
  const { id, seq: rawSeq } = await ctx.params;

  const seq = Number(rawSeq);

  if (!z.uuid().safeParse(id).success || !Number.isInteger(seq) || seq < 1)
    return Response.json({ error: "unknown slot" }, { status: 404 });

  const parsed = SlotBody.safeParse(await req.json().catch(() => null));

  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });

  const { clockMs, again = false } = parsed.data;

  const tag = `[session ${id.slice(0, 8)}] slot ${seq}`;

  const startedAt = Date.now();

  let stage = "loading session context";

  let stageAt = startedAt;

  const enterStage = (next: string) => {
    console.log(`${tag} timing: ${stage} ${Date.now() - stageAt}ms; starting ${next}`);

    stage = next;
    stageAt = Date.now();
  };

  const client = await pool().connect();

  let generationSaved = false;

  const heldOf = async (trackId: string): Promise<ReadonlySet<string>> => {
    const { rows } = await client.query<{ id: string }>("select id from track where id = $1", [trackId]);

    return new Set(rows.map((r) => r.id));
  };

  try {
    await client.query("begin");

    let session: { prompt: string; voice_id: string } | undefined;

    try {
      const { rows } = await client.query<{ prompt: string; voice_id: string }>(
        "select prompt, voice_id from session where id = $1 for update nowait",
        [id],
      );

      session = rows[0];
    } catch (err) {
      if (err instanceof Error && "code" in err && err.code === LOCK_NOT_AVAILABLE) {
        await client.query("rollback");

        return Response.json({ error: "session is already producing" }, { status: 409 });
      }

      throw err;
    }

    if (!session) {
      await client.query("rollback");

      return Response.json({ error: "unknown session" }, { status: 404 });
    }

    const { rows: slots } = await client.query<SlotRow & { id: string }>(
      `select id, ${SLOT_COLUMNS} from session_slot where session_id = $1 and seq = $2`,
      [id, seq],
    );

    let slot = slots[0];

    if (!slot) {
      await client.query("rollback");

      return Response.json({ error: `slot ${seq} is not proposed yet — fill first` }, { status: 404 });
    }

    if (slot.voiced_at && !(again && (slot.words || slot.lead_line || slot.legal_id))) {
      const doc = slotDoc(slot, await heldOf(slot.qobuz_id ?? ""));

      await client.query("rollback");

      return Response.json(doc);
    }

    const store = bucket();

    if (slot.qobuz_id === null) {
      let generation = slot.generation;

      if (!generation) {
        const [clock, identity, voices, config] = await Promise.all([
          loadClock(),
          loadIdentity(),
          loadVoices(),
          loadNews(),
        ]);

        const clockSaysBreak = isBreak(seq, clock.breakEvery);

        const { rows: lastBreak } = await client.query<{ clock_ms: number }>(
          "select clock_ms from session_slot where session_id = $1 and kind = 'break' and seq < $2 and clock_ms is not null order by seq desc limit 1",
          [id, seq],
        );

        const { rows: recent } = await client.query<RecentRow>(
          "select seq, kind, words, lead_line, title, artist from session_slot where session_id = $1 and seq < $2 and qobuz_id is not null order by seq desc limit $3",
          [id, seq, RECENT_SLOTS],
        );

        const { rows: played } = await client.query<{ title: string; artist: string }>(
          "select title, artist from session_slot where session_id = $1 and seq < $2 and qobuz_id is not null order by seq",
          [id, seq],
        );

        const { rows: previous } = await client.query<{
          seq: number;
          generation: SlotGeneration | null;
          news: NewsReceipt | null;
        }>(
          "select seq, generation, news from session_slot where session_id = $1 and seq <> $2 and (generation is not null or news is not null) order by seq",
          [id, seq],
        );

        const history: HeadlineHistory[] = previous.flatMap((r) =>
          (r.generation?.news.selected ?? []).map((h) => ({
            seq: r.seq,
            articleId: h.articleId,
            storyId: h.storyId,
            revision: h.revision,
            title: h.title,
            topic: h.topic,
          })),
        );

        enterStage("prepared news and weather");

        const newsEntry = clockSaysBreak ? await readPreparedNews(client, config, history) : null;

        const weatherEntry = clockSaysBreak ? await readPreparedWeather(client) : null;

        const jev = { apiKey: env().TYPESAFE_API_KEY, model: env().TYPESAFE_MODEL };

        enterStage("Jev recording and headlines");

        const decisions = await Promise.allSettled([
          producePick(
            {
              prompt: session.prompt,
              proposal: { title: slot.title, artist: slot.artist, why: slot.why },
              hits: slot.hits,
            },
            jev,
          ),

          chooseHeadlines(
            { prompt: session.prompt, headlines: newsEntry?.data ?? [], history, now: Date.now() },
            jev,
          ),
        ]);

        const [pickResult, newsResult] = decisions;

        if (pickResult.status === "rejected") throw pickResult.reason;

        if (newsResult.status === "rejected") throw newsResult.reason;

        const selection = pickResult.value;

        const choice = newsResult.value;

        if (selection.pick === null) throw new Error("Jev found no suitable recording for this slot");

        const hit = slot.hits.find((h) => h.id === selection.pick);

        if (!hit) throw new Error("Jev selected a recording outside this slot's hits");

        enterStage("Jev mixer planning");

        const planning = await producePlan(
          {
            prompt: session.prompt,
            seq,
            clockSaysBreak,
            stationName: identity.onAir,

            proposal: { title: slot.title, artist: slot.artist, why: slot.why },
            hit,

            recent: [...recent]
              .reverse()
              .map(({ title, artist, kind, words }) => ({ title, artist, kind, words })),

            contentWords: choice.selected.length * 25 + (weatherEntry ? 25 : 0),
          },
          jev,
        );

        const legalId =
          clockSaysBreak && legalIdDue(seq, clockMs, lastBreak[0]?.clock_ms ?? null)
            ? legalIdOf(identity)
            : null;

        const input: WriteInput = {
          prompt: session.prompt,
          dj: voices.find((v) => v.id === session.voice_id)?.name ?? null,
          identity,

          clock: clockOf(clockMs),
          seq,
          clockSaysBreak,
          proposal: { title: slot.title, artist: slot.artist, why: slot.why },
          hit,

          recent: [...recent].reverse().map((r) => ({ ...r, leadLine: r.lead_line })),
          played,

          plan: planning.plan,
          legalId,
          headlines: choice.selected,
          weather: weatherEntry?.data ?? null,
        };

        generation = {
          version: "prepared-1",
          id: crypto.randomUUID(),
          preparedAt: new Date().toISOString(),
          clockMs,

          selection: { ...selection, planning },

          news: {
            entryId: newsEntry?.id ?? null,
            date: newsEntry?.date ?? null,
            selected: choice.selected,
            choice,
          },

          weather: weatherEntry
            ? {
                entryId: weatherEntry.id,
                date: weatherEntry.date,
                data: weatherEntry.data,
              }
            : null,

          input,
        };

        await client.query("update session_slot set generation = $2 where id = $1", [
          slot.id,
          JSON.stringify(generation),
        ]);
      }

      // Roll back failed writing only to this point; committing the reservation prevents repeats.

      await client.query("savepoint generation_ready");

      generationSaved = true;

      const input = generation.input;

      enterStage("Claude unified script");

      const made =
        input.plan.kind === "segue"
          ? { written: { words: "", leadLine: "" }, receipt: undefined }
          : await produceWrite(input);

      generation = {
        ...generation,
        input,
        writer: made.receipt,
        attempts: [
          ...(generation.attempts ?? []),
          ...(made.receipt ? [{ at: new Date().toISOString(), input, writer: made.receipt }] : []),
        ],
      };
      let w;
      try {
        w = checkSlot(input.clockSaysBreak, input.plan, made.written, input.hit, input.legalId);
      } catch (err) {
        const attempt = generation.attempts?.at(-1);
        if (attempt) attempt.error = err instanceof Error ? err.message : String(err);
        await client.query("update session_slot set generation = $2 where id = $1", [
          slot.id,
          JSON.stringify(generation),
        ]);
        // Preserve returned-but-rejected copy as well as the original choices on an explicit retry.
        await client.query("savepoint generation_ready");
        throw err;
      }

      const at = new Date().toISOString();

      const news: NewsReceipt | null = input.clockSaysBreak
        ? {
            version: "prepared-1",
            snapshotId: generation.news.entryId ?? generation.id,
            selectedAt: generation.preparedAt,

            checkedAt: at,
            storyId: input.headlines[0]?.storyId ?? null,
            revision: input.headlines[0]?.revision ?? null,

            topic: input.headlines.map((h) => h.topic).join("; "),
            words: input.headlines.length ? w.words : null,

            stories: input.headlines.map(({ articleId, storyId, revision, title, topic }) => ({
              articleId,
              storyId,
              revision,
              title,
              topic,
            })),

            sources: input.headlines.map((h) => ({
              title: h.title,
              source: h.source,
              url: h.url,
              at: h.publishedAt,
            })),

            ...(input.weather && generation.weather
              ? {
                  weather: {
                    entryId: generation.weather.entryId,
                    observedAt: input.weather.observedAt,
                    forecastUpdatedAt: input.weather.forecastUpdatedAt,
                  },
                }
              : {}),

            reason: `Jev selected ${input.headlines.length} prepared headline(s). ${input.weather ? "Prepared weather included." : "No prepared weather."}`,
          }
        : null;

      enterStage("saving script and decisions");

      const { rows } = await client.query<SlotRow & { id: string }>(
        `update session_slot set qobuz_id = $2, clock_ms = $3,

          ramp_ms = $4, sure = $5, post = $6, outro = $7, outro_ms = $8, energy = $9, tempo = $10, mood = $11,

          kind = $12, words = $13, lead_line = $14, legal_id = $15, treatment = $16, fallback = $17,

          record_under_ms = $18, voice_in_ms = $19, news = $20, selection = $21, generation = $22

         where id = $1 returning id, ${SLOT_COLUMNS}`,

        [
          slot.id,
          w.qobuzId,
          generation.clockMs,
          w.rampMs,
          w.sure,
          w.post,
          w.outro,
          w.outroMs,
          w.energy,
          w.tempo,
          w.mood,

          w.kind,
          w.words,
          w.leadLine,
          w.legalId,
          w.treatment,
          null,
          w.recordUnderMs,
          w.voiceInMs,

          news ? JSON.stringify(news) : null,
          JSON.stringify(generation.selection),
          JSON.stringify(generation),
        ],
      );

      slot = rows[0];
    }

    enterStage("ElevenLabs voice");

    await client.query("savepoint script_ready");

    try {
      const said = [slot.legal_id, slot.words, slot.lead_line].filter(Boolean).join(" ");

      if (!said) {
        const { rows } = await client.query<SlotRow & { id: string }>(
          `update session_slot set voiced_at = now(), clip_key = null where id = $1 returning id, ${SLOT_COLUMNS}`,
          [slot.id],
        );

        slot = rows[0];
      } else {
        const voices = await loadVoices();

        const voice = voices.find((v) => v.id === session.voice_id) ?? voices[0];

        if (!voice) throw new Error("no voice on the roster (settings.voices)");

        const { request: voiceRequest, bytes } = await speak(voice, said, {
          apiKey: env().ELEVENLABS_KEY,
        });

        const clipKey = clipKeyOf(id, seq, slot.voiced_at ? crypto.randomUUID() : null);

        const generation = slot.generation
          ? {
              ...slot.generation,
              takes: [
                ...(slot.generation.takes ?? []),
                {
                  clipKey,
                  at: new Date().toISOString(),
                  words: slot.words ?? "",
                  legalId: slot.legal_id,
                  leadLine: slot.lead_line,

                  voiceId: voice.id,
                  request: voiceRequest,
                  bytes: bytes.byteLength,
                },
              ],
            }
          : null;

        enterStage("saving audio");

        await store.put(clipKey, bytes, "audio/mpeg");

        const { rows } = await client.query<SlotRow & { id: string }>(
          `update session_slot set clip_key = $2, voiced_at = now(), news = $3, generation = $4 where id = $1 returning id, ${SLOT_COLUMNS}`,

          [
            slot.id,
            clipKey,
            slot.news ? JSON.stringify(slot.news) : null,
            generation ? JSON.stringify(generation) : null,
          ],
        );

        slot = rows[0];

        console.log(`${tag} voiced: ${said.length} chars, ${bytes.byteLength} bytes`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      console.warn(`${tag} voice failed; retained script: ${message}`);

      await client.query("rollback to savepoint script_ready");

      const doc = slotDoc(slot, await heldOf(slot.qobuz_id ?? ""));

      await client.query("commit");

      return Response.json({ error: message, slot: doc }, { status: 502 });
    }

    const doc = slotDoc(slot, await heldOf(slot.qobuz_id ?? ""));

    await client.query("commit");

    return Response.json(doc);
  } catch (err) {
    if (generationSaved) {
      await client.query("rollback to savepoint generation_ready");

      await client.query("commit");
    } else await client.query("rollback");

    const message = err instanceof Error ? err.message : String(err);

    console.warn(`${tag} failed: ${message}`);

    return Response.json({ error: message }, { status: 502 });
  } finally {
    console.log(`${tag} timing: ${stage} ${Date.now() - stageAt}ms; total ${Date.now() - startedAt}ms`);

    client.release();
  }
}
