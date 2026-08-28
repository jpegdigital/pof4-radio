/** The slice of a Spotify track object the app cares about. */
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
  explicit: boolean;
  releaseDate: string | null;
}

/** Raw shape from the API (only the fields we read). */
export interface RawTrack {
  id: string;
  uri: string;
  name: string;
  duration_ms: number;
  explicit: boolean;
  artists: { name: string }[];
  album: {
    name: string;
    release_date?: string;
    images: { url: string; width: number | null; height: number | null }[];
  };
}

export const toTrack = (t: RawTrack): Track => ({
  id: t.id,
  uri: t.uri,
  name: t.name,
  artists: t.artists.map((a) => a.name),
  album: t.album.name,
  images: t.album.images,
  durationMs: t.duration_ms,
  explicit: t.explicit,
  releaseDate: t.album.release_date ?? null,
});
