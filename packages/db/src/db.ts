import type {
  Card as CardShape,
  Dropped,
  Element,
  Identity,
  Line,
  Note,
  Record,
  SegmentLog,
  Skeleton,
} from "@radio/dj";
import pg from "pg";

// ---- settings ------------------------------------------------------------------

/** One settings row (schema/settings.sql) — the only place its text lives. */
export interface Setting {
  key: string;
  value: string;
  updatedAt: Date;
}

interface SettingRow {
  key: string;
  value: string;
  updated_at: Date;
}

// ---- station / segment / card ----------------------------------------------------

/** The listener's show (schema/station.sql). Its memory is its kept segments. */
export interface Station {
  id: string;
  prompt: string;
  dj: string;
  voiceId: string;
  identity: Identity;
  /** null until discovery writes one (the row holds `{}`). */
  skeleton: Skeleton | null;
  segmentCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/** A past station as listed for resuming: enough to recognise it. */
export interface StationSummary {
  id: string;
  prompt: string;
  dj: string;
  segmentCount: number;
  updatedAt: Date;
}

/** Tokens per call, by stage; the shape is the producer's, opaque here. */
export type SegmentUsage = { [stage: string]: unknown };

/**
 * One kept segment (schema/segment.sql). It grows a slot at a time: `lines`, `log.slots`,
 * `elements` and `notes` cover the slots produced so far; `voicedAt` is set when the last one is.
 */
export interface Segment {
  id: string;
  stationId: string;
  seq: number;
  prompt: string;
  records: Record[];
  lines: Line[];
  log: SegmentLog;
  dropped: Dropped[];
  elements: Element[];
  notes: Note[];
  usage: SegmentUsage;
  model: string;
  writtenAt: Date;
  voicedAt: Date | null;
  createdAt: Date;
}

/** A record's card (schema/card.sql), keyed by Spotify track id. */
export interface Card extends CardShape {
  createdAt: Date;
  updatedAt: Date;
}

interface StationRow {
  id: string;
  prompt: string;
  dj: string;
  voice_id: string;
  identity: Identity;
  skeleton: Skeleton | { records?: undefined };
  segment_count: number;
  created_at: Date;
  updated_at: Date;
}

interface StationSummaryRow {
  id: string;
  prompt: string;
  dj: string;
  segment_count: number;
  updated_at: Date;
}

interface SegmentRow {
  id: string;
  station_id: string;
  seq: number;
  prompt: string;
  records: Record[];
  lines: Line[];
  log: SegmentLog;
  dropped: Dropped[];
  elements: Element[] | null;
  notes: Note[] | null;
  usage: SegmentUsage;
  model: string;
  written_at: Date;
  voiced_at: Date | null;
  created_at: Date;
}

interface CardRow {
  id: string;
  name: string;
  artists: string[];
  intro_ms: number;
  sure: boolean;
  post: string;
  outro: CardShape["outro"];
  outro_ms: number;
  energy: number;
  tempo: CardShape["tempo"];
  mood: string;
  notes: string[];
  thinking: string;
  model: string;
  created_at: Date;
  updated_at: Date;
}

const toStation = (r: StationRow): Station => ({
  id: r.id,
  prompt: r.prompt,
  dj: r.dj,
  voiceId: r.voice_id,
  identity: r.identity,
  skeleton: r.skeleton.records ? r.skeleton : null,
  segmentCount: r.segment_count,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toSegment = (r: SegmentRow): Segment => ({
  id: r.id,
  stationId: r.station_id,
  seq: r.seq,
  prompt: r.prompt,
  records: r.records,
  lines: r.lines,
  log: r.log,
  dropped: r.dropped,
  elements: r.elements ?? [],
  notes: r.notes ?? [],
  usage: r.usage,
  model: r.model,
  writtenAt: r.written_at,
  voicedAt: r.voiced_at,
  createdAt: r.created_at,
});

const toCard = (r: CardRow): Card => ({
  id: r.id,
  name: r.name,
  artists: r.artists,
  introMs: r.intro_ms,
  sure: r.sure,
  post: r.post,
  outro: r.outro,
  outroMs: r.outro_ms,
  energy: r.energy,
  tempo: r.tempo,
  mood: r.mood,
  notes: r.notes,
  thinking: r.thinking,
  model: r.model,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface CreateStationInput {
  prompt: string;
  dj: string;
  voiceId: string;
  identity: Identity;
}

/** A segment as it is opened: its records known, nothing produced yet. */
export interface CreateSegmentInput {
  prompt: string;
  records: Record[];
  log: SegmentLog;
  dropped: Dropped[];
  usage: SegmentUsage;
  model: string;
}

/** What a produced slot adds: the whole grown state of the segment, replaced at once. */
export interface SaveSegmentInput {
  lines: Line[];
  log: SegmentLog;
  elements: Element[];
  notes: Note[];
  usage: SegmentUsage;
  /** Every record has its slot: `voiced_at` is set and the row is immutable after. */
  complete: boolean;
}

/**
 * A station row held `for update` while a segment is opened or a slot produced. Everything
 * happens inside the same transaction; `release(ok)` commits or rolls back and returns the
 * connection — always call it, in a `finally`.
 */
export type StationLock =
  | { status: "missing" }
  | { status: "busy" }
  | {
      status: "ok";
      station: Station;
      setSkeleton: (skeleton: Skeleton) => Promise<void>;
      /** The station's kept segments, in seq order. */
      listSegments: () => Promise<Segment[]>;
      getSegment: (id: string) => Promise<Segment | null>;
      createSegment: (input: CreateSegmentInput) => Promise<Segment>;
      /** Refused (null) once the segment is complete. */
      saveSegment: (id: string, input: SaveSegmentInput) => Promise<Segment | null>;
      release: (ok: boolean) => Promise<void>;
    };

export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 5 });

  async function getSegment(id: string): Promise<Segment | null> {
    const { rows } = await pool.query<SegmentRow>("select * from segment where id = $1", [id]);
    return rows[0] ? toSegment(rows[0]) : null;
  }

  return {
    pool,

    // --- settings --------------------------------------------------------------

    async listSettings(): Promise<Setting[]> {
      const { rows } = await pool.query<SettingRow>("select * from settings order by key");
      return rows.map((r) => ({ key: r.key, value: r.value, updatedAt: r.updated_at }));
    },

    async getSetting(key: string): Promise<Setting | null> {
      const { rows } = await pool.query<SettingRow>("select * from settings where key = $1", [key]);
      const r = rows[0];
      return r ? { key: r.key, value: r.value, updatedAt: r.updated_at } : null;
    },

    async saveSetting(key: string, value: string): Promise<void> {
      await pool.query(
        "insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value",
        [key, value],
      );
    },

    // --- station -------------------------------------------------------------

    async createStation(input: CreateStationInput): Promise<Station> {
      const { rows } = await pool.query<StationRow>(
        "insert into station (prompt, dj, voice_id, identity) values ($1, $2, $3, $4) returning *",
        [input.prompt, input.dj, input.voiceId, JSON.stringify(input.identity)],
      );
      return toStation(rows[0]!);
    },

    async getStation(id: string): Promise<Station | null> {
      const { rows } = await pool.query<StationRow>("select * from station where id = $1", [id]);
      return rows[0] ? toStation(rows[0]) : null;
    },

    /** Stations that kept at least one segment, most recently active first. */
    async listStations(limit = 20): Promise<StationSummary[]> {
      const { rows } = await pool.query<StationSummaryRow>(
        "select id, prompt, dj, segment_count, updated_at from station where segment_count > 0 order by updated_at desc limit $1",
        [limit],
      );
      return rows.map((r) => ({
        id: r.id,
        prompt: r.prompt,
        dj: r.dj,
        segmentCount: r.segment_count,
        updatedAt: r.updated_at,
      }));
    },

    /**
     * Take the station's row lock for the duration of a production step. A second caller
     * (another tab) gets `busy` immediately instead of queueing behind a model call.
     */
    async lockStation(id: string): Promise<StationLock> {
      const client = await pool.connect();
      let done = false;
      const release = async (ok: boolean) => {
        if (done) return;
        done = true;
        try {
          await client.query(ok ? "commit" : "rollback");
        } finally {
          client.release();
        }
      };
      try {
        await client.query("begin");
        const { rows } = await client.query<StationRow>(
          "select * from station where id = $1 for update skip locked",
          [id],
        );
        if (!rows[0]) {
          await release(false);
          const exists = await pool.query("select 1 from station where id = $1", [id]);
          return { status: exists.rowCount ? "busy" : "missing" };
        }
        const station = toStation(rows[0]);
        return {
          status: "ok",
          station,
          release,
          async setSkeleton(skeleton) {
            await client.query("update station set skeleton = $2 where id = $1", [
              id,
              JSON.stringify(skeleton),
            ]);
            station.skeleton = skeleton;
          },
          async listSegments() {
            const seg = await client.query<SegmentRow>(
              "select * from segment where station_id = $1 order by seq asc",
              [id],
            );
            return seg.rows.map(toSegment);
          },
          async getSegment(segmentId) {
            const seg = await client.query<SegmentRow>(
              "select * from segment where id = $1 and station_id = $2",
              [segmentId, id],
            );
            return seg.rows[0] ? toSegment(seg.rows[0]) : null;
          },
          async createSegment(input) {
            const seg = await client.query<SegmentRow>(
              `insert into segment (station_id, seq, prompt, records, lines, log, dropped, elements, notes, usage, model)
               values ($1, $2, $3, $4, '[]', $5, $6, '[]', '[]', $7, $8) returning *`,
              [
                id,
                station.segmentCount + 1,
                input.prompt,
                JSON.stringify(input.records),
                JSON.stringify(input.log),
                JSON.stringify(input.dropped),
                JSON.stringify(input.usage),
                input.model,
              ],
            );
            await client.query(
              "update station set prompt = $2, segment_count = segment_count + 1 where id = $1",
              [id, input.prompt],
            );
            station.segmentCount += 1;
            station.prompt = input.prompt;
            return toSegment(seg.rows[0]!);
          },
          async saveSegment(segmentId, input) {
            const seg = await client.query<SegmentRow>(
              `update segment
                  set lines = $3, log = $4, elements = $5, notes = $6, usage = $7,
                      voiced_at = case when $8 then now() else null end
                where id = $1 and station_id = $2 and voiced_at is null
                returning *`,
              [
                segmentId,
                id,
                JSON.stringify(input.lines),
                JSON.stringify(input.log),
                JSON.stringify(input.elements),
                JSON.stringify(input.notes),
                JSON.stringify(input.usage),
                input.complete,
              ],
            );
            if (seg.rows[0]) await client.query("update station set updated_at = now() where id = $1", [id]);
            return seg.rows[0] ? toSegment(seg.rows[0]) : null;
          },
        };
      } catch (err) {
        await release(false);
        throw err;
      }
    },

    // --- segments --------------------------------------------------------------

    /** Every kept segment of a station, in seq order. */
    async listSegments(stationId: string): Promise<Segment[]> {
      const { rows } = await pool.query<SegmentRow>(
        "select * from segment where station_id = $1 order by seq asc",
        [stationId],
      );
      return rows.map(toSegment);
    },

    getSegment,

    // --- cards -----------------------------------------------------------------

    async getCards(ids: string[]): Promise<Map<string, Card>> {
      if (!ids.length) return new Map();
      const { rows } = await pool.query<CardRow>("select * from card where id = any($1::text[])", [ids]);
      return new Map(rows.map((r) => [r.id, toCard(r)]));
    },

    /** Insert or correct a card in place. */
    async putCard(card: CardShape): Promise<Card> {
      const { rows } = await pool.query<CardRow>(
        `insert into card (id, name, artists, intro_ms, sure, post, outro, outro_ms, energy, tempo, mood, notes, thinking, model)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         on conflict (id) do update set
           name = excluded.name, artists = excluded.artists, intro_ms = excluded.intro_ms, sure = excluded.sure,
           post = excluded.post, outro = excluded.outro, outro_ms = excluded.outro_ms, energy = excluded.energy,
           tempo = excluded.tempo, mood = excluded.mood, notes = excluded.notes, thinking = excluded.thinking,
           model = excluded.model, updated_at = now()
         returning *`,
        [
          card.id,
          card.name,
          JSON.stringify(card.artists),
          card.introMs,
          card.sure,
          card.post,
          card.outro,
          card.outroMs,
          card.energy,
          card.tempo,
          card.mood,
          JSON.stringify(card.notes),
          card.thinking,
          card.model,
        ],
      );
      return toCard(rows[0]!);
    },
  };
}

export type Db = ReturnType<typeof createDb>;
