import {
  clientCredentialsToken,
  type ClientConfig,
  refreshToken,
  searchTracks,
  type Track,
} from "@radio/spotify";
import type { SpotifyAccount } from "@radio/db";
import { db } from "./db";
import { env } from "./env";

/**
 * The web app's two Spotify tokens.
 *
 *  - app token (client credentials): search and lookup. Cached in the process; nobody's identity.
 *  - user token (authorization code): playback. The refresh token lives in Postgres
 *    (`spotify_account`, one row); `userAccessToken()` hands the player a fresh access token,
 *    refreshing it first when it is within a minute of expiring.
 */

export function clientConfig(): ClientConfig {
  const e = env();
  return { clientId: e.SPOTIFY_CLIENT_ID, clientSecret: e.SPOTIFY_CLIENT_SECRET };
}

const g = globalThis as unknown as { __spotifyApp?: { token: string; expiresAt: number } };

export async function appAccessToken(): Promise<string> {
  if (g.__spotifyApp && g.__spotifyApp.expiresAt - Date.now() > 60_000) return g.__spotifyApp.token;
  const t = await clientCredentialsToken(clientConfig());
  g.__spotifyApp = { token: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 };
  return g.__spotifyApp.token;
}

export const search = async (q: string, limit = 10): Promise<Track[]> =>
  searchTracks(await appAccessToken(), q, limit);

/** The connected account, with a usable access token — or null when nobody has connected yet. */
export async function userAccount(): Promise<SpotifyAccount | null> {
  const account = await db().getSpotifyAccount();
  if (!account) return null;
  if (account.expiresAt.getTime() - Date.now() > 60_000) return account;

  const t = await refreshToken(clientConfig(), account.refreshToken);
  const fresh: SpotifyAccount = {
    ...account,
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? account.refreshToken,
    scope: t.scope ?? account.scope,
    expiresAt: new Date(Date.now() + t.expires_in * 1000),
  };
  await db().saveSpotifyAccount(fresh);
  return fresh;
}
