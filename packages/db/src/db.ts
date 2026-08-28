import pg from "pg";

// ---- spotify_account -----------------------------------------------------------

/** The station's Spotify account (schema/spotify_account.sql). */
export interface SpotifyAccount {
  spotifyUserId: string;
  displayName: string | null;
  product: string | null;
  scope: string;
  refreshToken: string;
  accessToken: string;
  expiresAt: Date;
}

interface AccountRow {
  spotify_user_id: string;
  display_name: string | null;
  product: string | null;
  scope: string;
  refresh_token: string;
  access_token: string;
  expires_at: Date;
}

const toAccount = (r: AccountRow): SpotifyAccount => ({
  spotifyUserId: r.spotify_user_id,
  displayName: r.display_name,
  product: r.product,
  scope: r.scope,
  refreshToken: r.refresh_token,
  accessToken: r.access_token,
  expiresAt: r.expires_at,
});

// ---- segments ------------------------------------------------------------------

/** pg-boss queue the web app sends to and the worker works. */
export const SEGMENT_QUEUE = "segment";

export type SegmentStatus = "queued" | "planning" | "ready" | "played" | "failed";

/** A resolved Spotify track inside a segment — exactly what the player needs. */
export interface SegmentTrack {
  id: string;
  uri: string;
  name: string;
  artists: string[];
  album: string;
  durationMs: number;
}

export interface Segment {
  id: string;
  status: SegmentStatus;
  listenerPrompt: string;
  intro: string | null;
  outro: string | null;
  tracks: SegmentTrack[];
  model: string | null;
  error: string | null;
  playedAt: Date | null;
  createdAt: Date;
}

interface SegmentRow {
  id: string;
  status: SegmentStatus;
  listener_prompt: string;
  intro: string | null;
  outro: string | null;
  tracks: SegmentTrack[];
  model: string | null;
  error: string | null;
  played_at: Date | null;
  created_at: Date;
}

const toSegment = (r: SegmentRow): Segment => ({
  id: r.id,
  status: r.status,
  listenerPrompt: r.listener_prompt,
  intro: r.intro,
  outro: r.outro,
  tracks: r.tracks,
  model: r.model,
  error: r.error,
  playedAt: r.played_at,
  createdAt: r.created_at,
});

export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 5 });

  return {
    pool,

    // --- spotify account ---------------------------------------------------

    async getSpotifyAccount(): Promise<SpotifyAccount | null> {
      const { rows } = await pool.query<AccountRow>("select * from spotify_account where id");
      return rows[0] ? toAccount(rows[0]) : null;
    },

    /** Upsert the singleton. Called after the OAuth callback and after every refresh. */
    async saveSpotifyAccount(a: SpotifyAccount): Promise<void> {
      await pool.query(
        `insert into spotify_account
           (id, spotify_user_id, display_name, product, scope, refresh_token, access_token, expires_at)
         values (true, $1, $2, $3, $4, $5, $6, $7)
         on conflict (id) do update set
           spotify_user_id = excluded.spotify_user_id,
           display_name = excluded.display_name,
           product = excluded.product,
           scope = excluded.scope,
           refresh_token = excluded.refresh_token,
           access_token = excluded.access_token,
           expires_at = excluded.expires_at`,
        [a.spotifyUserId, a.displayName, a.product, a.scope, a.refreshToken, a.accessToken, a.expiresAt],
      );
    },

    // --- segments ------------------------------------------------------------

    async createSegment(listenerPrompt: string): Promise<Segment> {
      const { rows } = await pool.query<SegmentRow>(
        "insert into segments (listener_prompt) values ($1) returning *",
        [listenerPrompt],
      );
      return toSegment(rows[0]!);
    },

    async getSegment(id: string): Promise<Segment | null> {
      const { rows } = await pool.query<SegmentRow>("select * from segments where id = $1", [id]);
      return rows[0] ? toSegment(rows[0]) : null;
    },

    /** Newest first. The page shows these; the player picks the oldest `ready` one. */
    async listSegments(limit = 20): Promise<Segment[]> {
      const { rows } = await pool.query<SegmentRow>(
        "select * from segments order by created_at desc limit $1",
        [limit],
      );
      return rows.map(toSegment);
    },

    async startSegment(id: string, model: string): Promise<void> {
      await pool.query("update segments set status = 'planning', model = $2 where id = $1", [id, model]);
    },

    async finishSegment(
      id: string,
      out: { intro: string; outro: string; tracks: SegmentTrack[] },
    ): Promise<void> {
      await pool.query(
        "update segments set status = 'ready', intro = $2, outro = $3, tracks = $4 where id = $1",
        [id, out.intro, out.outro, JSON.stringify(out.tracks)],
      );
    },

    async failSegment(id: string, error: string): Promise<void> {
      await pool.query("update segments set status = 'failed', error = $2 where id = $1", [id, error]);
    },

    async markPlayed(id: string): Promise<void> {
      await pool.query(
        "update segments set status = 'played', played_at = now() where id = $1 and status = 'ready'",
        [id],
      );
    },

    /**
     * What the station has played (or has lined up) lately — the DJ's "don't repeat
     * yourself" memory. Newest segment first, tracks in play order within it.
     */
    async recentTracks(segments = 6): Promise<SegmentTrack[]> {
      const { rows } = await pool.query<{ tracks: SegmentTrack[] }>(
        `select tracks from segments
         where status in ('ready', 'played', 'planning')
         order by created_at desc limit $1`,
        [segments],
      );
      return rows.flatMap((r) => r.tracks);
    },

    async close() {
      await pool.end();
    },
  };
}

export type Db = ReturnType<typeof createDb>;
