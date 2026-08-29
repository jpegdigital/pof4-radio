import pg from "pg";

// ---- settings ------------------------------------------------------------------

/** One prompt slot (schema/settings.sql) — the only place its text lives. */
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

// ---- station / segment ---------------------------------------------------------

/** A resolved Spotify track inside a segment — exactly what the player needs. */
export interface SegmentTrack {
  id: string;
  uri: string;
  name: string;
  artists: string[];
  album: string;
  durationMs: number;
}

/** One finished segment: the spoken bridge and its tracks (schema/segment.sql). */
export interface Segment {
  id: string;
  stationId: string;
  seq: number;
  prompt: string;
  talk: string;
  tracks: SegmentTrack[];
  model: string;
  createdAt: Date;
}

/** The listener's show (schema/station.sql). `messages` is the DJ conversation, opaque here. */
export interface Station {
  id: string;
  prompt: string;
  messages: unknown[];
  segmentCount: number;
  createdAt: Date;
}

/** A past station as listed for resuming: enough to recognise it, nothing of the conversation. */
export interface StationSummary {
  id: string;
  prompt: string;
  segmentCount: number;
  updatedAt: Date;
}

interface StationSummaryRow {
  id: string;
  prompt: string;
  segment_count: number;
  updated_at: Date;
}

interface SegmentRow {
  id: string;
  station_id: string;
  seq: number;
  prompt: string;
  talk: string;
  tracks: SegmentTrack[];
  model: string;
  created_at: Date;
}

interface StationRow {
  id: string;
  prompt: string;
  messages: unknown[];
  segment_count: number;
  created_at: Date;
}

const toSegment = (r: SegmentRow): Segment => ({
  id: r.id,
  stationId: r.station_id,
  seq: r.seq,
  prompt: r.prompt,
  talk: r.talk,
  tracks: r.tracks,
  model: r.model,
  createdAt: r.created_at,
});

const toStation = (r: StationRow): Station => ({
  id: r.id,
  prompt: r.prompt,
  messages: r.messages,
  segmentCount: r.segment_count,
  createdAt: r.created_at,
});

/** Everything a finished segment writes, in one transaction (see `lockStation`). */
export interface CommitInput {
  prompt: string;
  messages: unknown[];
  talk: string;
  tracks: SegmentTrack[];
  model: string;
}

/**
 * A station row held `for update` while the DJ plans. `commit` inserts the segment and updates
 * the station inside the same transaction; `release(ok)` commits or rolls back and returns the
 * connection. Always call `release` — in a `finally`.
 */
export type StationLock =
  | { status: "missing" }
  | { status: "busy" }
  | {
      status: "ok";
      station: Station;
      commit: (input: CommitInput) => Promise<Segment>;
      release: (ok: boolean) => Promise<void>;
    };

export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 5 });

  return {
    pool,

    // --- settings --------------------------------------------------------------

    async listSettings(): Promise<Setting[]> {
      const { rows } = await pool.query<SettingRow>("select * from settings order by key");
      return rows.map((r) => ({ key: r.key, value: r.value, updatedAt: r.updated_at }));
    },

    async saveSetting(key: string, value: string): Promise<void> {
      await pool.query(
        "insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value",
        [key, value],
      );
    },

    // --- station -------------------------------------------------------------

    async createStation(prompt: string): Promise<Station> {
      const { rows } = await pool.query<StationRow>("insert into station (prompt) values ($1) returning *", [
        prompt,
      ]);
      return toStation(rows[0]!);
    },

    async getStation(id: string): Promise<Station | null> {
      const { rows } = await pool.query<StationRow>("select * from station where id = $1", [id]);
      return rows[0] ? toStation(rows[0]) : null;
    },

    /** Stations that produced at least one segment, most recently active first. */
    async listStations(limit = 20): Promise<StationSummary[]> {
      const { rows } = await pool.query<StationSummaryRow>(
        "select id, prompt, segment_count, updated_at from station where segment_count > 0 order by updated_at desc limit $1",
        [limit],
      );
      return rows.map((r) => ({
        id: r.id,
        prompt: r.prompt,
        segmentCount: r.segment_count,
        updatedAt: r.updated_at,
      }));
    },

    /**
     * Take the station's row lock for the duration of planning. A second caller (another tab)
     * gets `busy` immediately instead of queueing behind a 60-second model call.
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
          async commit(input) {
            const seg = await client.query<SegmentRow>(
              `insert into segment (station_id, seq, prompt, talk, tracks, model)
               values ($1, $2, $3, $4, $5, $6) returning *`,
              [
                id,
                station.segmentCount + 1,
                input.prompt,
                input.talk,
                JSON.stringify(input.tracks),
                input.model,
              ],
            );
            await client.query(
              "update station set prompt = $2, messages = $3, segment_count = segment_count + 1 where id = $1",
              [id, input.prompt, JSON.stringify(input.messages)],
            );
            return toSegment(seg.rows[0]!);
          },
        };
      } catch (err) {
        await release(false);
        throw err;
      }
    },

    // --- segment history -------------------------------------------------------

    /** Newest first. */
    async listSegments(stationId: string, limit = 20): Promise<Segment[]> {
      const { rows } = await pool.query<SegmentRow>(
        "select * from segment where station_id = $1 order by seq desc limit $2",
        [stationId, limit],
      );
      return rows.map(toSegment);
    },

    async lastSegment(stationId: string): Promise<Segment | null> {
      const { rows } = await pool.query<SegmentRow>(
        "select * from segment where station_id = $1 order by seq desc limit 1",
        [stationId],
      );
      return rows[0] ? toSegment(rows[0]) : null;
    },

    async close() {
      await pool.end();
    },
  };
}

export type Db = ReturnType<typeof createDb>;
