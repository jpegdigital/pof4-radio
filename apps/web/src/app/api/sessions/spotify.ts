import { env } from "@/lib/env";

/**
 * The server's one Spotify call: track search on the app's own token (client credentials —
 * needs the secret, so server only; nobody's identity), cached in the process for its hour.
 * Playback is the browser's business on the listener's own token (app/(app)/lib/spotify-account.ts);
 * the server never holds a user token. Plain fetch, no SDK.
 */

const ACCOUNTS = "https://accounts.spotify.com";
const API = "https://api.spotify.com/v1";

export class SpotifyError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "SpotifyError";
  }
}

const g = globalThis as unknown as { __spotifyApp?: { token: string; expiresAt: number } };

/** The app token, refreshed a minute before it lapses. */
async function appToken(): Promise<string> {
  if (g.__spotifyApp && g.__spotifyApp.expiresAt - Date.now() > 60_000) return g.__spotifyApp.token;
  const e = env();
  const res = await fetch(`${ACCOUNTS}/api/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${e.SPOTIFY_CLIENT_ID}:${e.SPOTIFY_CLIENT_SECRET}`)}`,
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  const body = await res.text();
  if (!res.ok) throw new SpotifyError(`spotify token request failed (${res.status})`, res.status, body);
  const t = JSON.parse(body) as { access_token: string; expires_in: number };
  g.__spotifyApp = { token: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 };
  return t.access_token;
}

/** The slice of a Spotify track the playlist keeps. */
export interface Track {
  id: string;
  /** spotify:track:<id> — what the player takes. */
  uri: string;
  name: string;
  artists: string[];
  album: string;
  /** Album art, largest first. */
  images: { url: string; width: number | null; height: number | null }[];
  durationMs: number;
}

interface RawTrack {
  id: string;
  uri: string;
  name: string;
  duration_ms: number;
  artists: { name: string }[];
  album: { name: string; images: { url: string; width: number | null; height: number | null }[] };
}

/** `GET /search?type=track`, the US market. */
export async function search(q: string, limit = 10): Promise<Track[]> {
  const url = new URL(`${API}/search`);
  url.searchParams.set("q", q);
  url.searchParams.set("type", "track");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("market", "US");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await appToken()}` } });
  const body = await res.text();
  if (!res.ok) throw new SpotifyError(`spotify search failed (${res.status})`, res.status, body);
  const data = JSON.parse(body) as { tracks: { items: RawTrack[] } };
  return data.tracks.items.map((t) => ({
    id: t.id,
    uri: t.uri,
    name: t.name,
    artists: t.artists.map((a) => a.name),
    album: t.album.name,
    images: t.album.images,
    durationMs: t.duration_ms,
  }));
}
