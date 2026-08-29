import type { PlayerFace } from "./player";

/**
 * What the lock screen shows for a player face. Pure; the hook (use-media-session.ts) hands it
 * to `navigator.mediaSession`. Spotify's largest album image is the only art we have (its size
 * isn't known here, so no `sizes` — iOS takes it as is); the talk has none.
 */
export interface LockScreen {
  title: string;
  artist: string;
  album: string;
  artwork: { src: string }[];
}

export function lockScreen(face: PlayerFace): LockScreen {
  switch (face.kind) {
    case "track":
      return {
        title: face.name,
        artist: face.artists.join(", "),
        album: face.album,
        artwork: face.image ? [{ src: face.image }] : [],
      };
    case "talk":
      return { title: `${face.dj} on the mic`, artist: face.excerpt, album: "Radio", artwork: [] };
    case "planning":
      return { title: `${face.dj} is picking the tracks…`, artist: "", album: "Radio", artwork: [] };
  }
}
