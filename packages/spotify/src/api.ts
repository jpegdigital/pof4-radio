import { type RawTrack, type Track, toTrack } from "./types.ts";

const API = "https://api.spotify.com/v1";

export class SpotifyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
  }
}

async function get<T>(accessToken: string, path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = await res.text();
  if (!res.ok) throw new SpotifyApiError(`spotify ${path} failed (${res.status})`, res.status, body);
  return JSON.parse(body) as T;
}

/** `GET /search?type=track` — works with either token flow. */
export async function searchTracks(
  accessToken: string,
  q: string,
  limit = 10,
  market = "US",
): Promise<Track[]> {
  const data = await get<{ tracks: { items: RawTrack[] } }>(accessToken, "/search", {
    q,
    type: "track",
    limit: String(limit),
    market,
  });
  return data.tracks.items.map(toTrack);
}

export async function getTrack(accessToken: string, id: string, market = "US"): Promise<Track> {
  return toTrack(await get<RawTrack>(accessToken, `/tracks/${id}`, { market }));
}

export interface Me {
  id: string;
  display_name: string | null;
  /** "premium" | "free" | … (needs user-read-private). Playback needs premium. */
  product?: string;
}

export const me = (accessToken: string) => get<Me>(accessToken, "/me");

/** Start playback of `uris` on a device (the browser's Web Playback SDK player, in our case). */
export async function play(accessToken: string, deviceId: string, uris: string[]): Promise<void> {
  const res = await fetch(`${API}/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ uris }),
  });
  if (!res.ok) throw new SpotifyApiError(`spotify play failed (${res.status})`, res.status, await res.text());
}
