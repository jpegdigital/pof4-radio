import { clientCredentialsToken, type ClientConfig, searchTracks, type Track } from "@radio/spotify";
import { env } from "./env";

/**
 * The server's one Spotify token: the app token (client credentials) for search and lookup,
 * cached in the process, nobody's identity. Playback tokens are the browser's business
 * (components/station/spotify-account.ts) — the server never holds a user's Spotify token.
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
