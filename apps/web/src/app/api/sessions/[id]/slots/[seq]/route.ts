import { z } from "zod";
import { speak } from "@/lib/elevenlabs";
import { env } from "@/lib/env";
import { loadClock, loadIdentity, loadNews, loadVoices } from "@/lib/settings";
import type { NewsReceipt } from "@/lib/news";
import { readPreparedNews, readPreparedWeather } from "@/lib/prepared";
import { slotDoc } from "../../../doc";
import { chooseHeadlines } from "../../../headline-choice";
import { producePick } from "../../../pick";
import { producePlan } from "../../../planning";
import { SlotBody } from "../../../params";
import { checkSlot, isBreak, legalIdDue } from "../../../rules";
import { heldAmong, type LockedShow, lockShow, SessionBusy, UnknownSession } from "../../../show-store";
import { clockOf, legalIdOf, produceWrite, type WriteInput } from "../../../write";

/** One retained pipeline: DB facts -> Jev choices/plan -> one Claude script -> one TTS.
 * Session row locking serializes reservations. A savepoint retains all prepared decisions on a
 * writer failure; a voice failure retains the script too. Retries never research or reselect.
 * Playback uses the saved production. Generation inputs and every take remain retained.
 */

const RECENT_SLOTS = 3;

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

  let show: LockedShow | undefined;

  let generationSaved = false;

  try {
    try {
      show = await lockShow(id);
    } catch (err) {
      if (err instanceof SessionBusy) return Response.json({ error: err.message }, { status: 409 });

      if (err instanceof UnknownSession) return Response.json({ error: err.message }, { status: 404 });

      throw err;
    }

    const voiceId = show.voiceId;

    let slot = await show.slot(seq);

    if (!slot) {
      await show.rollback();

      return Response.json({ error: `slot ${seq} is not proposed yet — fill first` }, { status: 404 });
    }

    if (slot.voiced_at && !(again && (slot.words || slot.lead_line || slot.legal_id))) {
      const doc = slotDoc(slot, await heldAmong(slot.qobuz_id === null ? [] : [slot.qobuz_id]));

      await show.rollback();

      return Response.json(doc);
    }

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

        const lastBreakClockMs = await show.lastBreakClockMs(seq);

        const recent = await show.recentCopy(seq, RECENT_SLOTS);

        const played = await show.played(seq);

        const history = await show.reservedNews(seq);

        enterStage("prepared news and weather");

        const newsEntry = clockSaysBreak ? await readPreparedNews(show.client, config, history) : null;

        const weatherEntry = clockSaysBreak ? await readPreparedWeather(show.client) : null;

        const jev = { apiKey: env().TYPESAFE_API_KEY, model: env().TYPESAFE_MODEL };

        enterStage("Jev recording and headlines");

        const decisions = await Promise.allSettled([
          producePick(
            {
              prompt: show.prompt,
              proposal: { title: slot.title, artist: slot.artist, why: slot.why },
              hits: slot.hits,
            },
            jev,
          ),

          chooseHeadlines(
            { prompt: show.prompt, headlines: newsEntry?.data ?? [], history, now: Date.now() },
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
            prompt: show.prompt,
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
          clockSaysBreak && legalIdDue(seq, clockMs, lastBreakClockMs) ? legalIdOf(identity) : null;

        const input: WriteInput = {
          prompt: show.prompt,
          dj: voices.find((v) => v.id === voiceId)?.name ?? null,
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

        await show.saveGeneration(slot.id, generation);
      }

      // Roll back failed writing only to this point; committing the reservation prevents repeats.

      await show.keep("generation_ready");

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
        await show.saveGeneration(slot.id, generation);
        // Preserve returned-but-rejected copy as well as the original choices on an explicit retry.
        await show.keep("generation_ready");
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

      slot = await show.saveWritten(slot.id, w, news, generation);
    }

    enterStage("ElevenLabs voice");

    await show.keep("script_ready");

    try {
      const said = [slot.legal_id, slot.words, slot.lead_line].filter(Boolean).join(" ");

      if (!said) {
        slot = await show.voicedDry(slot.id);
      } else {
        const voices = await loadVoices();

        const voice = voices.find((v) => v.id === voiceId) ?? voices[0];

        if (!voice) throw new Error("no voice on the roster (settings.voices)");

        const { request: voiceRequest, bytes } = await speak(voice, said, {
          apiKey: env().ELEVENLABS_KEY,
        });

        const clipKey = show.clipKey(seq, slot.voiced_at !== null);

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

        slot = await show.saveTake(slot.id, clipKey, bytes, slot.news ?? null, generation);

        console.log(`${tag} voiced: ${said.length} chars, ${bytes.byteLength} bytes`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      console.warn(`${tag} voice failed; retained script: ${message}`);

      await show.backTo("script_ready");

      const doc = slotDoc(slot, await heldAmong(slot.qobuz_id === null ? [] : [slot.qobuz_id]));

      await show.commit();

      return Response.json({ error: message, slot: doc }, { status: 502 });
    }

    const doc = slotDoc(slot, await heldAmong(slot.qobuz_id === null ? [] : [slot.qobuz_id]));

    await show.commit();

    return Response.json(doc);
  } catch (err) {
    if (show && generationSaved) {
      await show.backTo("generation_ready");

      await show.commit();
    } else if (show) await show.rollback();

    const message = err instanceof Error ? err.message : String(err);

    console.warn(`${tag} failed: ${message}`);

    return Response.json({ error: message }, { status: 502 });
  } finally {
    console.log(`${tag} timing: ${stage} ${Date.now() - stageAt}ms; total ${Date.now() - startedAt}ms`);

    show?.release();
  }
}
