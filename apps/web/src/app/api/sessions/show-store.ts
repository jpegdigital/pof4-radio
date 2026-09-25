import { bucket } from "@/lib/bucket";
import { pool } from "@/lib/db";
import type { NewsReceipt } from "@/lib/news";
import type { Hit, SlotRow, Tags } from "./doc";
import type { SlotGeneration } from "./generation";
import type { HeadlineHistory } from "./headline-choice";
import type { WrittenSlot } from "./rules";

/**
 * The show as kept: the one place that knows the `session`, `session_slot` and `track` tables, the
 * bucket keys, the session lock and the write order. Plain SQL, named for what the station asks.
 *
 * Two laws live here and nowhere else:
 * - A rung works under the session's row lock (`lockShow`); a second producer is `SessionBusy`.
 * - Bucket first, row second (`saveTake`, `keepTrack`): a row always means the bytes exist.
 * Staged failure is the rung's to decide; the store only gives it the means: `keep` marks what
 * survives, `backTo` + `commit` lands it after a later failure.
 */

const LOCK_NOT_AVAILABLE = "55P03";

/** The columns `SlotRow` reads, in one place so every read selects the same. */
const SLOT_COLUMNS =
  "seq, title, artist, why, hits, qobuz_id, clock_ms, ramp_ms, sure, post, outro, outro_ms, energy, tempo, mood, kind, words, lead_line, legal_id, treatment, fallback, record_under_ms, voice_in_ms, clip_key, voiced_at, news, generation";

export class SessionBusy extends Error {
  constructor() {
    super("session is already producing");
  }
}

export class UnknownSession extends Error {
  constructor() {
    super("unknown session");
  }
}

const clipKeyOf = (id: string, seq: number, take: string | null) =>
  `sessions/${id}/${seq}${take ? `-${take}` : ""}.mp3`;

const audioKeyOf = (trackId: string) => `tracks/${trackId}.mp3`;

type StoredSlot = SlotRow & { id: string };

/** A slot as the fill sees it: enough to know what played and what is coming. */
interface SlotBrief {
  seq: number;
  title: string;
  artist: string;
  qobuz_id: string | null;
}

/** An earlier picked slot's copy, newest first. */
interface RecentCopy {
  seq: number;
  kind: string;
  words: string | null;
  lead_line: string | null;
  title: string;
  artist: string;
}

/** What survives a later failure, in the order a slot reaches them. */
type KeepPoint = "generation_ready" | "script_ready";

export type LockedShow = Awaited<ReturnType<typeof lockShow>>;

/**
 * The session, locked for one rung, in a transaction the caller ends (`commit` or `rollback`, then
 * `release`). Busy or unknown: rolled back and released here, then thrown.
 */
export async function lockShow(id: string) {
  const client = await pool().connect();
  let session: { prompt: string; voice_id: string } | undefined;
  try {
    await client.query("begin");
    const { rows } = await client.query<{ prompt: string; voice_id: string }>(
      "select prompt, voice_id from session where id = $1 for update nowait",
      [id],
    );
    session = rows[0];
  } catch (err) {
    await client.query("rollback");
    client.release();
    if (err instanceof Error && "code" in err && err.code === LOCK_NOT_AVAILABLE) throw new SessionBusy();
    throw err;
  }
  if (!session) {
    await client.query("rollback");
    client.release();
    throw new UnknownSession();
  }

  return {
    prompt: session.prompt,
    voiceId: session.voice_id,
    /** For a reader that must share this transaction (the prepared editions). */
    client,

    async slot(seq: number): Promise<StoredSlot | undefined> {
      const { rows } = await client.query<StoredSlot>(
        `select id, ${SLOT_COLUMNS} from session_slot where session_id = $1 and seq = $2`,
        [id, seq],
      );
      return rows[0];
    },

    async slots(): Promise<SlotBrief[]> {
      const { rows } = await client.query<SlotBrief>(
        "select seq, title, artist, qobuz_id from session_slot where session_id = $1 order by seq",
        [id],
      );
      return rows;
    },

    async append(afterSeq: number, proposed: { title: string; artist: string; why: string; hits: Hit[] }[]) {
      const added: SlotRow[] = [];
      for (const [i, s] of proposed.entries()) {
        const { rows } = await client.query<SlotRow>(
          `insert into session_slot (session_id, seq, title, artist, why, hits)
         values ($1, $2, $3, $4, $5, $6) returning ${SLOT_COLUMNS}`,
          [id, afterSeq + i + 1, s.title, s.artist, s.why, JSON.stringify(s.hits)],
        );
        added.push(rows[0]);
      }
      return added;
    },

    async lastBreakClockMs(seq: number): Promise<number | null> {
      const { rows } = await client.query<{ clock_ms: number }>(
        "select clock_ms from session_slot where session_id = $1 and kind = 'break' and seq < $2 and clock_ms is not null order by seq desc limit 1",
        [id, seq],
      );
      return rows[0]?.clock_ms ?? null;
    },

    async recentCopy(seq: number, limit: number): Promise<RecentCopy[]> {
      const { rows } = await client.query<RecentCopy>(
        "select seq, kind, words, lead_line, title, artist from session_slot where session_id = $1 and seq < $2 and qobuz_id is not null order by seq desc limit $3",
        [id, seq, limit],
      );
      return rows;
    },

    async played(seq: number): Promise<{ title: string; artist: string }[]> {
      const { rows } = await client.query<{ title: string; artist: string }>(
        "select title, artist from session_slot where session_id = $1 and seq < $2 and qobuz_id is not null order by seq",
        [id, seq],
      );
      return rows;
    },

    /** Every story another slot of this session has reserved, heard or not. */
    async reservedNews(seq: number): Promise<HeadlineHistory[]> {
      const { rows } = await client.query<{
        seq: number;
        generation: SlotGeneration | null;
        news: NewsReceipt | null;
      }>(
        "select seq, generation, news from session_slot where session_id = $1 and seq <> $2 and (generation is not null or news is not null) order by seq",
        [id, seq],
      );
      return rows.flatMap((r) =>
        (r.generation?.news.selected ?? []).map((h) => ({
          seq: r.seq,
          articleId: h.articleId,
          storyId: h.storyId,
          revision: h.revision,
          title: h.title,
          topic: "topic" in h ? h.topic : h.title,
        })),
      );
    },

    async saveGeneration(slotId: string, generation: SlotGeneration): Promise<void> {
      await client.query("update session_slot set generation = $2 where id = $1", [
        slotId,
        JSON.stringify(generation),
      ]);
    },

    async saveWritten(
      slotId: string,
      w: WrittenSlot,
      news: NewsReceipt | null,
      generation: SlotGeneration,
    ): Promise<StoredSlot> {
      const { rows } = await client.query<StoredSlot>(
        `update session_slot set qobuz_id = $2, clock_ms = $3,

          ramp_ms = $4, sure = $5, post = $6, outro = $7, outro_ms = $8, energy = $9, tempo = $10, mood = $11,

          kind = $12, words = $13, lead_line = $14, legal_id = $15, treatment = $16, fallback = $17,

          record_under_ms = $18, voice_in_ms = $19, news = $20, selection = $21, generation = $22

         where id = $1 returning id, ${SLOT_COLUMNS}`,
        [
          slotId,
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
      return rows[0];
    },

    /** A segue: voiced, with no clip. */
    async voicedDry(slotId: string): Promise<StoredSlot> {
      const { rows } = await client.query<StoredSlot>(
        `update session_slot set voiced_at = now(), clip_key = null where id = $1 returning id, ${SLOT_COLUMNS}`,
        [slotId],
      );
      return rows[0];
    },

    /** The first take is the slot's own key; another take is a new key. */
    clipKey(seq: number, another: boolean): string {
      return clipKeyOf(id, seq, another ? crypto.randomUUID() : null);
    },

    /** Bucket first, row second. */
    async saveTake(
      slotId: string,
      clipKey: string,
      bytes: Uint8Array,
      news: NewsReceipt | null,
      generation: SlotGeneration | null,
    ): Promise<StoredSlot> {
      await bucket().put(clipKey, bytes, "audio/mpeg");
      const { rows } = await client.query<StoredSlot>(
        `update session_slot set clip_key = $2, voiced_at = now(), news = $3, generation = $4 where id = $1 returning id, ${SLOT_COLUMNS}`,
        [slotId, clipKey, news ? JSON.stringify(news) : null, generation ? JSON.stringify(generation) : null],
      );
      return rows[0];
    },

    async keep(point: KeepPoint): Promise<void> {
      await client.query(`savepoint ${point}`);
    },

    async backTo(point: KeepPoint): Promise<void> {
      await client.query(`rollback to savepoint ${point}`);
    },

    async commit(): Promise<void> {
      await client.query("commit");
    },

    async rollback(): Promise<void> {
      await client.query("rollback");
    },

    release(): void {
      client.release();
    },
  };
}

// Without the lock: creation, the snapshot, the log, the streams, the heard receipt.

export async function openSession(prompt: string, voiceId: string): Promise<string> {
  const { rows } = await pool().query<{ id: string }>(
    "insert into session (prompt, voice_id) values ($1, $2) returning id",
    [prompt, voiceId],
  );
  return rows[0].id;
}

interface StoredSession {
  id: string;
  prompt: string;
  voiceId: string;
  createdAt: Date;
}

export async function sessionOf(id: string): Promise<StoredSession | undefined> {
  const { rows } = await pool().query<{ id: string; prompt: string; voice_id: string; created_at: Date }>(
    "select id, prompt, voice_id, created_at from session where id = $1",
    [id],
  );
  const s = rows[0];
  return s && { id: s.id, prompt: s.prompt, voiceId: s.voice_id, createdAt: s.created_at };
}

export async function slotsOf(id: string): Promise<SlotRow[]> {
  const { rows } = await pool().query<SlotRow>(
    `select ${SLOT_COLUMNS} from session_slot where session_id = $1 order by seq`,
    [id],
  );
  return rows;
}

/** The latest sessions with how many slots each has, newest first. */
export async function sessionLog(limit: number): Promise<(StoredSession & { slots: number })[]> {
  const { rows } = await pool().query<{
    id: string;
    prompt: string;
    voice_id: string;
    created_at: Date;
    slots: string;
  }>(
    `select s.id, s.prompt, s.voice_id, s.created_at, count(l.id) as slots
       from session s left join session_slot l on l.session_id = s.id
       group by s.id order by s.created_at desc limit $1`,
    [limit],
  );
  return rows.map((r) => ({
    id: r.id,
    prompt: r.prompt,
    voiceId: r.voice_id,
    createdAt: r.created_at,
    slots: Number(r.slots),
  }));
}

/** A slot's pick id (null until written) and the hits it was picked from. */
export async function pickedOf(
  id: string,
  seq: number,
): Promise<{ pickId: string | null; hits: Hit[] } | undefined> {
  const { rows } = await pool().query<{ qobuz_id: string | null; hits: Hit[] }>(
    "select qobuz_id, hits from session_slot where session_id = $1 and seq = $2",
    [id, seq],
  );
  return rows[0] && { pickId: rows[0].qobuz_id, hits: rows[0].hits };
}

/** A slot's current clip key and the key of every take it has kept. */
export async function clipKeysOf(
  id: string,
  seq: number,
): Promise<{ clipKey: string | null; takeKeys: string[] } | undefined> {
  const { rows } = await pool().query<{ clip_key: string | null; generation: SlotGeneration | null }>(
    "select clip_key, generation from session_slot where session_id = $1 and seq = $2",
    [id, seq],
  );
  return (
    rows[0] && {
      clipKey: rows[0].clip_key,
      takeKeys: (rows[0].generation?.takes ?? []).map((take) => take.clipKey),
    }
  );
}

export const openClip = (clipKey: string) => bucket().open(clipKey);

/** One row per story of the break, once its clip was heard in full. False when nothing was new. */
export async function recordHeard(id: string, seq: number, clipKey: string): Promise<boolean> {
  const { rowCount } = await pool().query(
    `insert into session_news_exposure (session_id, seq, clip_key, story_id, revision)
     select s.session_id, s.seq, s.clip_key, story->>'storyId', story->>'revision'
     from session_slot s cross join lateral jsonb_array_elements(
       coalesce(s.news->'stories', '[]'::jsonb)
     ) story
     where s.session_id = $1 and s.seq = $2 and s.clip_key = $3 and s.news->>'words' is not null
       and story->>'storyId' is not null and story->>'revision' is not null
     on conflict do nothing`,
    [id, seq, clipKey],
  );
  return Boolean(rowCount);
}

// The library: tracks belong to every session, so none of this is under a session's lock.

export async function heldAmong(trackIds: string[]): Promise<ReadonlySet<string>> {
  const { rows } = await pool().query<{ id: string }>("select id from track where id = any($1::text[])", [
    trackIds,
  ]);
  return new Set(rows.map((r) => r.id));
}

export const trackHeld = async (trackId: string) => (await heldAmong([trackId])).has(trackId);

async function insertTrack(pick: Tags, key: string, bytes: number): Promise<void> {
  await pool().query(
    `insert into track (id, title, artists, album, image, duration_ms, audio_key, bytes)
     values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (id) do nothing`,
    [pick.id, pick.title, JSON.stringify(pick.artists), pick.album, pick.image, pick.durationMs, key, bytes],
  );
}

/** Bytes with no row (a crash between the PUT and the insert, or the row wiped): the row rebuilt. */
export async function adoptTrack(pick: Tags): Promise<{ contentLength: number | null } | null> {
  const key = audioKeyOf(pick.id);
  const found = await bucket().head(key);
  if (found) await insertTrack(pick, key, found.contentLength ?? 0);
  return found;
}

/** Bucket first, row second. */
export async function keepTrack(pick: Tags, bytes: Uint8Array, mimeType: string): Promise<void> {
  const key = audioKeyOf(pick.id);
  await bucket().put(key, bytes, mimeType);
  await insertTrack(pick, key, bytes.byteLength);
}

/** One lookup proves the slot's pick and finds its held media. Signing does no bucket I/O. */
export async function trackPlayback(id: string, seq: number) {
  const { rows } = await pool().query<{ audio_key: string; duration_ms: number }>(
    `select t.audio_key, t.duration_ms from session_slot s
     join track t on t.id = s.qobuz_id
     where s.session_id = $1 and s.seq = $2
       and exists (select 1 from jsonb_array_elements(s.hits) h where h->>'id' = s.qobuz_id)`,
    [id, seq],
  );
  const track = rows[0];
  return track ? bucket().playback(track.audio_key, track.duration_ms) : null;
}
