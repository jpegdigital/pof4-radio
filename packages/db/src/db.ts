import pg from "pg";

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

export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 5 });

  return {
    pool,

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

    async close() {
      await pool.end();
    },
  };
}

export type Db = ReturnType<typeof createDb>;
