import { z } from "zod";
import { bucket } from "@/lib/bucket";
import { pool } from "@/lib/db";
import { env } from "@/lib/env";
import { claude } from "@/lib/claude";
import { loadClock, loadIdentity, loadNews, loadVoices } from "@/lib/settings";
import { NEWS_AIR_MARGIN_MS, newsExpired, type NewsReceipt } from "@/lib/news";
import { ttsBody } from "@/lib/voices";
import { SLOT_COLUMNS, type SlotRow, slotDoc } from "../../../doc";
import { readHeadlines, type HeadlineSnapshot } from "../../../headlines";
import { editHeadlines, type NewsHistory } from "../../../headline-edit";
import { producePick } from "../../../pick";
import { producePlan } from "../../../planning";
import { SlotBody } from "../../../params";
import { checkSlot, isBreak, legalIdDue } from "../../../rules";
import { fetchWeather, WEATHER_PLACE, weatherText } from "../../../weather";
import { clockOf, legalIdOf, produceWrite, type RecentSlot } from "../../../write";

/**
 * POST /api/sessions/:id/slots/:seq — the slot rung: write, then voice, in one request under the
 * session lock (a second producer gets 409). Body `{ clockMs, again?, live? }`. Live preflight can
 * replace invalid news with a prepared safe take; legacy breaks retain only ID and lead-in.
 * Otherwise, in order of precedence:
 * no such slot → 404 (fill first); voiced and not `again` → the kept row; voiced with `again`
 * and words → another take under a new key, the words untouched; written but not voiced (a
 * voicing that failed) → voice only; proposed → write, then voice. The write: the clock says
 * whether this slot is the break and whether the legal ID is due; the brief gathers the last
 * slots' copy, everything played, and for a break the weather.
 * Feed discovery precedes the lock; a separate editor checks news against evidence and history.
 * Approved news is inserted outside the music writer. Jev selects the recording, estimates its
 * chart, and chooses an executable mixer plan. Claude writes only its copy, concurrently with
 * news editing. Failed decisions or invalid copy stop the request; one update keeps every receipt. The voice is PUT before
 * the row is stamped. A voicing failure keeps the completed write, which
 * is committed and the answer is 502 with the slot as written; the next request voices only.
 */

const LOCK_NOT_AVAILABLE = "55P03";
/** How many earlier slots' copy the writer sees. */
const RECENT_SLOTS = 3;

/** The first take is `<seq>.mp3`; every take after carries when it was made, so no two keys collide. */
const clipKeyOf = (sessionId: string, seq: number, take: string | null) =>
  `sessions/${sessionId}/${seq}${take ? `-${take}` : ""}.mp3`;

/** Weather for the music brief; a failure is logged and the slot goes on without it. */
const forBrief = async (tag: string, what: string, pull: () => Promise<string>): Promise<string | null> => {
  try {
    return await pull();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${tag} ${what} pull failed, writing without it: ${message}`);
    return null;
  }
};

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
  const p = await ctx.params;
  const seq = Number(p.seq);
  const id = p.id;
  if (!z.uuid().safeParse(id).success || !Number.isInteger(seq) || seq < 1)
    return Response.json({ error: "unknown slot" }, { status: 404 });
  const parsed = SlotBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  const { clockMs, again = false, live = false } = parsed.data;
  const store = bucket();
  if (!store)
    return Response.json({ error: "the clips bucket is not configured (BUCKET_*)" }, { status: 503 });
  const key = env().ELEVENLABS_KEY;
  if (!key) return Response.json({ error: "ELEVENLABS_KEY is not set on the server" }, { status: 503 });
  const tag = `[session ${id.slice(0, 8)}] slot ${seq}`;

  const startedAt = Date.now();
  let stage = "news discovery";
  let stageAt = startedAt;
  const enterStage = (next: string) => {
    console.log(`${tag} timing: ${stage} ${Date.now() - stageAt}ms; starting ${next}`);
    stage = next;
    stageAt = Date.now();
  };
  console.log(`${tag} starting ${stage}`);

  // Read-only discovery happens before owning the session transaction. Recheck the slot below.
  let snapshot: HeadlineSnapshot | null = null;
  const { rows: preflight } = await pool().query<{ qobuz_id: string | null }>(
    "select qobuz_id from session_slot where session_id = $1 and seq = $2",
    [id, seq],
  );
  if (preflight[0]?.qobuz_id === null) {
    try {
      const [clock, config] = await Promise.all([loadClock(), loadNews()]);
      if (isBreak(seq, clock.breakEvery)) snapshot = await readHeadlines(config);
    } catch (err) {
      console.warn(`${tag} news discovery unavailable: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  enterStage("loading session context");
  const client = await pool().connect();
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
    let slot: SlotRow & { id: string } = slots[0];
    if (!slot) {
      await client.query("rollback");
      return Response.json({ error: `slot ${seq} is not proposed yet — fill first` }, { status: 404 });
    }

    // Live validity and immutable storage are different. A new take removes expired news only.
    let replacingNews = false;
    if (live && slot.kind === "break" && !slot.news) {
      const at = new Date().toISOString();
      slot.news = {
        snapshotId: crypto.randomUUID(),
        selectedAt: at,
        checkedAt: at,
        expiresAt: at,
        storyId: null,
        revision: null,
        topic: "",
        words: null,
        musicWords: "",
        sources: [],
        reason: "Legacy break had no news evidence receipt; refreshed with its ID and music lead-in only",
        previous: slot.clip_key
          ? [{ clipKey: slot.clip_key, words: slot.words ?? "", at: slot.voiced_at?.toISOString() ?? at }]
          : [],
      };
      await client.query("insert into headline_snapshot (id, snapshot, audit) values ($1, $2, $3)", [
        slot.news.snapshotId,
        JSON.stringify({
          id: slot.news.snapshotId,
          at,
          config: { ...(await loadNews()), enabled: false },
          articles: [],
          sources: [],
        }),
        JSON.stringify({ legacy: true }),
      ]);
      slot.words = "";
      replacingNews = true;
    }
    if (live && slot.news?.words) {
      const newsConfig = await loadNews();
      const { rows: story } = await client.query<{ revision: string }>(
        "select revision from headline_story where id = $1",
        [slot.news.storyId],
      );
      const changed = story[0] && story[0].revision !== slot.news.revision;
      if (!newsConfig.enabled || newsExpired(slot.news, Date.now() + NEWS_AIR_MARGIN_MS) || changed) {
        const previous = slot.clip_key
          ? [
              ...(slot.news.previous ?? []),
              {
                clipKey: slot.clip_key,
                words: slot.words ?? "",
                at: slot.voiced_at?.toISOString() ?? new Date().toISOString(),
              },
            ]
          : slot.news.previous;
        slot.news = {
          ...slot.news,
          previous,
          words: null,
          reason: changed ? "A newer story revision is available" : "News expired before live playback",
        };
        slot.words = slot.news.musicWords ?? "";
        replacingNews = true;
      }
    }
    if (replacingNews && slot.news?.fallbackClipKey) {
      const { rows } = await client.query<SlotRow & { id: string }>(
        `update session_slot set words = $2, news = $3, clip_key = $4, voiced_at = now() where id = $1 returning id, ${SLOT_COLUMNS}`,
        [slot.id, slot.words, JSON.stringify(slot.news), slot.news.fallbackClipKey],
      );
      slot = rows[0];
      const held = await heldOf(slot.qobuz_id ?? "");
      await client.query("commit");
      return Response.json(slotDoc(slot, held));
    }
    if (slot.voiced_at && !replacingNews && !(again && slot.words)) {
      const held = await heldOf(slot.qobuz_id ?? "");
      await client.query("rollback");
      return Response.json(slotDoc(slot, held));
    }

    // ---- the write ------------------------------------------------------------------------
    let wrote = false;
    if (slot.qobuz_id === null) {
      const [clock, identity, voices] = await Promise.all([loadClock(), loadIdentity(), loadVoices()]);
      const dj = voices.find((v) => v.id === session.voice_id)?.name ?? null;
      const clockSaysBreak = isBreak(seq, clock.breakEvery);
      // One client, so one query at a time (pg runs a client's queries serially).
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
      enterStage("Jev selection");
      const selection = await producePick(
        {
          prompt: session.prompt,
          proposal: { title: slot.title, artist: slot.artist, why: slot.why },
          hits: slot.hits,
        },
        { apiKey: env().TYPESAFE_API_KEY, model: env().TYPESAFE_MODEL },
      );
      console.log(`${tag} Jev selection: ${JSON.stringify(selection)}`);
      if (selection.pick === null) throw new Error("Jev found no suitable recording for this slot");
      const hit = slot.hits.find((h) => h.id === selection.pick);
      if (!hit) throw new Error("Jev selected a recording outside this slot's hits");
      enterStage("Jev planning and weather");
      const legalId =
        clockSaysBreak && legalIdDue(seq, clockMs, lastBreak[0]?.clock_ms ?? null)
          ? legalIdOf(identity)
          : null;
      const [planning, weather] = await Promise.all([
        producePlan(
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
          },
          { apiKey: env().TYPESAFE_API_KEY, model: env().TYPESAFE_MODEL },
        ),
        clockSaysBreak
          ? forBrief(tag, "weather", async () => weatherText(await fetchWeather(), WEATHER_PLACE.timeZone))
          : Promise.resolve(null),
      ]);
      console.log(tag + " Jev planning: " + JSON.stringify(planning));
      enterStage("news editing and DJ copy");
      const editNews = async () => {
        const started = Date.now();
        try {
          let news: NewsReceipt | null = null;
          if (clockSaysBreak && snapshot) {
            const currentConfig = await loadNews();
            if (JSON.stringify(currentConfig) !== JSON.stringify(snapshot.config))
              snapshot = { ...snapshot, config: { ...currentConfig, enabled: false } };
            const { rows: history } = await client.query<NewsHistory>(
              `select s.news->>'storyId' as "storyId", coalesce(h.audit->>'articleId', '') as "articleId",
             coalesce(h.audit->>'articleRevision', '') as revision, s.news->>'topic' as topic,
             coalesce(s.news->>'words', h.audit->'draft'->>'words', '') as words, s.news->>'selectedAt' as at,
             exists (select 1 from session_news_exposure e where e.session_id = s.session_id and e.seq = s.seq and e.story_id = s.news->>'storyId' and e.revision = s.news->>'revision') as heard
           from session_slot s left join headline_snapshot h on h.id::text = s.news->>'snapshotId'
           where s.session_id = $1 and s.seq < $2 and s.news->>'storyId' is not null
             and (s.news->>'selectedAt')::timestamptz > now() - ($3 * interval '1 hour')
           order by s.seq desc limit 60`,
              [id, seq, currentConfig.memoryHours],
            );
            const edited = await editHeadlines(
              snapshot,
              history,
              session.prompt,
              `${slot.artist} — ${slot.title}`,
              { client: claude(), model: env().CLAUDE_MODEL },
            );
            news = edited.receipt;
            await client.query("insert into headline_snapshot (id, snapshot, audit) values ($1, $2, $3)", [
              snapshot.id,
              JSON.stringify(snapshot),
              JSON.stringify(edited.audit),
            ]);
            if (news.storyId && news.revision) {
              const audit = edited.audit as {
                articleId: string;
                articleRevision: string;
                articleFetchedAt: string;
              };
              await client.query(
                `insert into headline_story (id, revision, article_id, article_revision, snapshot_id, updated_at)
            values ($1, $2, $3, $4, $5, $6) on conflict (id) do update set revision = excluded.revision,
            article_id = excluded.article_id, article_revision = excluded.article_revision, snapshot_id = excluded.snapshot_id, updated_at = excluded.updated_at
            where headline_story.updated_at <= excluded.updated_at`,
                [
                  news.storyId,
                  news.revision,
                  audit.articleId,
                  audit.articleRevision,
                  snapshot.id,
                  audit.articleFetchedAt,
                ],
              );
            }
          }
          return news;
        } finally {
          console.log(tag + " news editing: " + (Date.now() - started) + "ms");
        }
      };
      const writeCopy = async () => {
        if (planning.plan.kind === "segue") return { written: { words: "", leadLine: "" }, thinking: "" };
        const started = Date.now();
        try {
          return await produceWrite({
            prompt: session.prompt,
            dj,
            identity,
            clock: clockOf(clockMs),
            seq,
            clockSaysBreak,
            proposal: { title: slot.title, artist: slot.artist, why: slot.why },
            hit,
            recent: recent.reverse().map(
              (r): RecentSlot => ({
                seq: r.seq,
                kind: r.kind,
                words: r.words,
                leadLine: r.lead_line,
                title: r.title,
                artist: r.artist,
              }),
            ),
            played,
            plan: planning.plan,
            legalId,
            weather,
            newsReserved: Boolean(clockSaysBreak && snapshot?.config.enabled),
          });
        } finally {
          console.log(tag + " DJ copy: " + (Date.now() - started) + "ms");
        }
      };
      // Settle both before ending the transaction: the news lane writes its evidence receipt.
      const [edited, written] = await Promise.allSettled([editNews(), writeCopy()]);
      if (edited.status === "rejected") throw edited.reason;
      if (written.status === "rejected") throw written.reason;
      let news = edited.value;
      const made = written.value;

      enterStage("saving opening script");
      const w = checkSlot(clockSaysBreak, planning.plan, made.written, hit, legalId);
      const thinking = made.thinking;
      if (news) {
        news.musicWords = w.words ?? "";
        if (w.kind !== "break" || newsExpired(news, Date.now()))
          news = { ...news, words: null, reason: "No valid news at composition" };
        w.words = [news.words, w.words].filter(Boolean).join(" ") || null;
      }
      const { rows } = await client.query<SlotRow & { id: string }>(
        `update session_slot set
           qobuz_id = $2, clock_ms = $3,
           ramp_ms = $4, sure = $5, post = $6, outro = $7, outro_ms = $8, energy = $9, tempo = $10, mood = $11,
           kind = $12, words = $13, lead_line = $14, legal_id = $15, treatment = $16, fallback = $17,
           record_under_ms = $18, voice_in_ms = $19, thinking = $20, news = $21, selection = $22
         where id = $1 returning id, ${SLOT_COLUMNS}`,
        [
          slot.id,
          w.qobuzId,
          clockMs,
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
          w.fallback ? JSON.stringify(w.fallback) : null,
          w.recordUnderMs,
          w.voiceInMs,
          thinking,
          news ? JSON.stringify(news) : null,
          JSON.stringify({ ...selection, planning }),
        ],
      );
      slot = rows[0];
      wrote = true;
      const pick = slot.hits.find((h) => h.id === slot.qobuz_id);
      console.log(
        `${tag} written: ${slot.kind}, ${pick?.artists.join(", ")} — ${pick?.title} (${slot.qobuz_id})${legalId ? ", with the legal ID" : ""}`,
      );
      if (w.fallback) console.log(`${tag}: ${w.fallback.from} → ${w.fallback.to}: ${w.fallback.reason}`);
    }

    enterStage("ElevenLabs voicing");
    // ---- the voice ------------------------------------------------------------------------
    try {
      // Failed TTS retries must not revive expired facts. Archive revoice is explicit via again.
      if (!again && !slot.voiced_at && newsExpired(slot.news ?? undefined, Date.now()) && slot.news) {
        slot.words = slot.news.musicWords ?? "";
        slot.news = { ...slot.news, words: null, reason: "News expired before voicing" };
      }
      const said = [slot.legal_id, slot.words, slot.lead_line].filter(Boolean).join(" ");
      if (!said) {
        // Nothing to say: done, silent.
        const { rows } = await client.query<SlotRow & { id: string }>(
          `update session_slot set voiced_at = now(), words = $2, news = $3, clip_key = null where id = $1 returning id, ${SLOT_COLUMNS}`,
          [slot.id, slot.words, slot.news ? JSON.stringify(slot.news) : null],
        );
        slot = rows[0];
      } else {
        const voices = await loadVoices();
        const voice = voices.find((v) => v.id === session.voice_id) ?? voices[0];
        if (!voice) throw new Error("no voice on the roster (settings.voices)");
        const res = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice.id)}?output_format=mp3_44100_128`,
          {
            method: "POST",
            headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
            body: JSON.stringify(ttsBody(voice, said)),
            signal: AbortSignal.timeout(30_000),
          },
        );
        if (!res.ok)
          throw new Error(`elevenlabs ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        // Keep a news-free take ready before any time-sensitive clip becomes playable.
        // The player can use it even if revalidation is offline; the legal ID is preserved.
        if (slot.news?.words && !slot.news.fallbackClipKey) {
          enterStage("news-free voice and storage");
          const fallbackText = [slot.legal_id, slot.news.musicWords, slot.lead_line]
            .filter(Boolean)
            .join(" ");
          if (fallbackText) {
            const fallback = await fetch(
              `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice.id)}?output_format=mp3_44100_128`,
              {
                method: "POST",
                headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
                body: JSON.stringify(ttsBody(voice, fallbackText)),
                signal: AbortSignal.timeout(30_000),
              },
            );
            if (!fallback.ok) throw new Error(`news-free voice HTTP ${fallback.status}`);
            const fallbackKey = `sessions/${id}/${seq}-news-free-${crypto.randomUUID()}.mp3`;
            await store.put(fallbackKey, new Uint8Array(await fallback.arrayBuffer()), "audio/mpeg");
            slot.news = { ...slot.news, fallbackClipKey: fallbackKey };
          }
        }
        const clipKey = clipKeyOf(id, seq, slot.voiced_at ? crypto.randomUUID() : null);
        if (slot.news && slot.clip_key && !replacingNews)
          slot.news = {
            ...slot.news,
            previous: [
              ...(slot.news.previous ?? []),
              {
                clipKey: slot.clip_key,
                words: slot.words ?? "",
                at: slot.voiced_at?.toISOString() ?? new Date().toISOString(),
              },
            ],
          };
        enterStage("saving audio");
        await store.put(clipKey, bytes, "audio/mpeg");
        const { rows } = await client.query<SlotRow & { id: string }>(
          `update session_slot set clip_key = $2, voiced_at = now(), words = $3, news = $4 where id = $1 returning id, ${SLOT_COLUMNS}`,
          [slot.id, clipKey, slot.words, slot.news ? JSON.stringify(slot.news) : null],
        );
        console.log(
          `${tag} voiced${slot.voiced_at ? " again" : ""}: ${slot.kind}, ${said.length} chars, ${bytes.byteLength} bytes`,
        );
        slot = rows[0];
      }
    } catch (err) {
      // The write, if any, is kept: the next request voices only.
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`${tag} voicing failed${wrote ? " after the write" : ""}: ${message}`);
      const held = await heldOf(slot.qobuz_id ?? "");
      await client.query("commit");
      return Response.json({ error: message, slot: slotDoc(slot, held) }, { status: 502 });
    }
    const held = await heldOf(slot.qobuz_id ?? "");
    await client.query("commit");
    return Response.json(slotDoc(slot, held));
  } catch (err) {
    await client.query("rollback");
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${tag} failed: ${message}`);
    return Response.json({ error: message }, { status: 502 });
  } finally {
    console.log(`${tag} timing: ${stage} ${Date.now() - stageAt}ms; total ${Date.now() - startedAt}ms`);
    client.release();
  }
}
