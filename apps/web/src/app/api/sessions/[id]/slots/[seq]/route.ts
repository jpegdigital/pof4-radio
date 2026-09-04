import { z } from "zod";
import { bucket } from "@/lib/bucket";
import { pool } from "@/lib/db";
import { env } from "@/lib/env";
import { loadClock, loadIdentity, loadVoices } from "@/lib/settings";
import { ttsBody } from "@/lib/voices";
import { SLOT_COLUMNS, type SlotRow, slotDoc } from "../../../doc";
import { fetchHeadlines, headlinesText } from "../../../headlines";
import { SlotBody } from "../../../params";
import { checkSlot, isBreak, legalIdDue, type WrittenSlot } from "../../../rules";
import { fetchWeather, WEATHER_PLACE, weatherText } from "../../../weather";
import { clockOf, legalIdOf, type PriorChart, produceWrite, type RecentSlot } from "../../../write";

/**
 * POST /api/sessions/:id/slots/:seq — the slot rung: write, then voice, in one request under the
 * session lock (a second producer gets 409). Body `{ clockMs, again? }`. In order of precedence:
 * no such slot → 404 (fill first); voiced and not `again` → the kept row; voiced with `again`
 * and words → another take under a new key, the words untouched; written but not voiced (a
 * voicing that failed) → voice only; proposed → write, then voice. The write: the clock says
 * whether this slot is the break and whether the legal ID is due; the brief gathers the last
 * slots' copy, everything played, another DJ's chart of any hit, and for a break the weather and
 * the headlines (a failed pull is logged and the show goes on); one Claude call picks the version,
 * charts it, writes the copy and sets the timing; the house rules (rules.ts) hold it to the clock;
 * one update lands every written column. The writer giving nothing usable twice makes the slot a
 * segue on the first hit, no chart, the reason as its treatment. The voice: the slot's text (legal
 * ID, words, lead line) through ElevenLabs in the session's voice, PUT to the bucket at
 * `sessions/<id>/<seq>[-take].mp3`, then the row stamped — bucket first, row second. A slot with
 * nothing to say is stamped voiced with no clip. If the voicing fails after a write, the write
 * is committed and the answer is 502 with the slot as written; the next request voices only.
 */

const LOCK_NOT_AVAILABLE = "55P03";
/** How many earlier slots' copy the writer sees. */
const RECENT_SLOTS = 3;
/** How many other sessions' charts of a hit the writer sees. */
const PRIOR_CHARTS = 3;

/** The first take is `<seq>.mp3`; every take after carries when it was made, so no two keys collide. */
const clipKeyOf = (sessionId: string, seq: number, take: string | null) =>
  `sessions/${sessionId}/${seq}${take ? `-${take}` : ""}.mp3`;

/** A pull for the brief — the weather, the headlines; a failure is logged and the slot goes on without it. */
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

interface PriorRow {
  qobuz_id: string;
  hits: SlotRow["hits"];
  ramp_ms: number;
  sure: boolean;
  post: string;
  outro: string;
  outro_ms: number;
  energy: number;
  tempo: string;
  mood: string;
  words: string | null;
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
  const { clockMs, again = false } = parsed.data;
  const store = bucket();
  if (!store)
    return Response.json({ error: "the clips bucket is not configured (BUCKET_*)" }, { status: 503 });
  const key = env().ELEVENLABS_KEY;
  if (!key) return Response.json({ error: "ELEVENLABS_KEY is not set on the server" }, { status: 503 });
  const tag = `[session ${id.slice(0, 8)}] slot ${seq}`;

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

    // Idempotent: voiced returns the kept row, no production — unless asked for another take of something said.
    if (slot.voiced_at && !(again && slot.words)) {
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
      const [{ rows: lastBreak }, { rows: recent }, { rows: played }, { rows: priors }] = await Promise.all([
        client.query<{ clock_ms: number }>(
          "select clock_ms from session_slot where session_id = $1 and kind = 'break' and seq < $2 and clock_ms is not null order by seq desc limit 1",
          [id, seq],
        ),
        client.query<RecentRow>(
          "select seq, kind, words, lead_line, title, artist from session_slot where session_id = $1 and seq < $2 and qobuz_id is not null order by seq desc limit $3",
          [id, seq, RECENT_SLOTS],
        ),
        client.query<{ title: string; artist: string }>(
          "select title, artist from session_slot where session_id = $1 and seq < $2 and qobuz_id is not null order by seq",
          [id, seq],
        ),
        client.query<PriorRow>(
          "select qobuz_id, hits, ramp_ms, sure, post, outro, outro_ms, energy, tempo, mood, words from session_slot where qobuz_id = any($1::text[]) and session_id <> $2 and ramp_ms is not null order by created_at desc limit $3",
          [slot.hits.map((h) => h.id), id, PRIOR_CHARTS],
        ),
      ]);
      const legalId =
        clockSaysBreak && legalIdDue(seq, clockMs, lastBreak[0]?.clock_ms ?? null)
          ? legalIdOf(identity)
          : null;
      const [weather, headlines] = clockSaysBreak
        ? await Promise.all([
            forBrief(tag, "weather", async () => weatherText(await fetchWeather(), WEATHER_PLACE.timeZone)),
            forBrief(tag, "headlines", async () => headlinesText(await fetchHeadlines(), WEATHER_PLACE.city)),
          ])
        : [null, null];
      const made = await produceWrite({
        prompt: session.prompt,
        dj,
        identity,
        clock: clockOf(clockMs),
        seq,
        clockSaysBreak,
        proposal: { title: slot.title, artist: slot.artist, why: slot.why },
        hits: slot.hits,
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
        priorCharts: priors.flatMap((r): PriorChart[] => {
          const h = r.hits.find((x) => x.id === r.qobuz_id);
          return h
            ? [
                {
                  id: h.id,
                  title: h.title,
                  artists: h.artists,
                  rampMs: r.ramp_ms,
                  sure: r.sure,
                  post: r.post,
                  outro: r.outro,
                  outroMs: r.outro_ms,
                  energy: r.energy,
                  tempo: r.tempo,
                  mood: r.mood,
                  words: r.words,
                },
              ]
            : [];
        }),
        legalId,
        weather,
        headlines,
      });

      let w:
        | WrittenSlot
        | (Pick<
            WrittenSlot,
            | "qobuzId"
            | "kind"
            | "words"
            | "leadLine"
            | "legalId"
            | "treatment"
            | "fallback"
            | "recordUnderMs"
            | "voiceInMs"
          > & { chart: null });
      let thinking = "";
      if (made) {
        const hit = slot.hits.find((h) => h.id === made.written.pick) ?? slot.hits[0];
        w = checkSlot(clockSaysBreak, made.written, hit, legalId);
        thinking = made.thinking;
      } else {
        // The writer gave nothing usable twice: a segue on the first hit, no chart. The show goes on.
        w = {
          chart: null,
          qobuzId: slot.hits[0].id,
          kind: "segue",
          words: null,
          leadLine: null,
          legalId: null,
          treatment: "the writer gave nothing usable twice: a segue on the first version found",
          fallback: null,
          recordUnderMs: null,
          voiceInMs: null,
        };
      }
      const chart = "chart" in w ? null : w;
      const { rows } = await client.query<SlotRow & { id: string }>(
        `update session_slot set
           qobuz_id = $2, clock_ms = $3,
           ramp_ms = $4, sure = $5, post = $6, outro = $7, outro_ms = $8, energy = $9, tempo = $10, mood = $11,
           kind = $12, words = $13, lead_line = $14, legal_id = $15, treatment = $16, fallback = $17,
           record_under_ms = $18, voice_in_ms = $19, thinking = $20
         where id = $1 returning id, ${SLOT_COLUMNS}`,
        [
          slot.id,
          w.qobuzId,
          clockMs,
          chart?.rampMs ?? null,
          chart?.sure ?? null,
          chart?.post ?? null,
          chart?.outro ?? null,
          chart?.outroMs ?? null,
          chart?.energy ?? null,
          chart?.tempo ?? null,
          chart?.mood ?? null,
          w.kind,
          w.words,
          w.leadLine,
          w.legalId,
          w.treatment,
          w.fallback ? JSON.stringify(w.fallback) : null,
          w.recordUnderMs,
          w.voiceInMs,
          thinking,
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

    // ---- the voice ------------------------------------------------------------------------
    try {
      const said = [slot.legal_id, slot.words, slot.lead_line].filter(Boolean).join(" ");
      if (!said) {
        // Nothing to say: done, silent.
        const { rows } = await client.query<SlotRow & { id: string }>(
          `update session_slot set voiced_at = now() where id = $1 returning id, ${SLOT_COLUMNS}`,
          [slot.id],
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
          },
        );
        if (!res.ok)
          throw new Error(`elevenlabs ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const clipKey = clipKeyOf(id, seq, slot.voiced_at ? Date.now().toString(36) : null);
        await store.put(clipKey, bytes, "audio/mpeg");
        const { rows } = await client.query<SlotRow & { id: string }>(
          `update session_slot set clip_key = $2, voiced_at = now() where id = $1 returning id, ${SLOT_COLUMNS}`,
          [slot.id, clipKey],
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
    client.release();
  }
}
