import { useCallback, useEffect, useRef, useState } from "react";
import { accessToken } from "./spotify-account";

/**
 * The browser as the Spotify device. The Web Playback SDK only *creates* the device; playback
 * is `PUT /me/player/play?device_id=…` with this browser's own token (spotify-account.ts,
 * refreshed in place). Playback state comes back through `player_state_changed`.
 */

interface SdkPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: string, cb: (payload: unknown) => void): void;
  setVolume(v: number): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  /** Mobile Safari: must be called inside a user gesture before the SDK may make sound. */
  activateElement(): Promise<void>;
}
interface SdkTrack {
  uri: string;
  name: string;
  artists: { name: string }[];
  album: { name: string; images: { url: string; width?: number | null }[] };
}
interface SdkState {
  paused: boolean;
  position: number;
  duration: number;
  track_window: { current_track: SdkTrack | null; next_tracks: unknown[] };
}
declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void;
    Spotify?: {
      Player: new (opts: {
        name: string;
        getOAuthToken: (cb: (token: string) => void) => void;
        volume?: number;
      }) => SdkPlayer;
    };
  }
}

export type DeviceStatus =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "ready"; id: string }
  | { kind: "error"; message: string };

export interface NowPlaying {
  uri: string;
  name: string;
  artists: string[];
  album: string;
  /** Largest album image, if any. */
  image: string | null;
}

export interface Playback {
  uri: string | null;
  paused: boolean;
  track: NowPlaying | null;
  /** Position/duration in ms as of `at` (performance.now()); the UI interpolates while playing. */
  position: number;
  duration: number;
  at: number;
}

export interface SpotifyDevice {
  status: DeviceStatus;
  playback: Playback | null;
  connect(): Promise<void>;
  /**
   * Call synchronously from a tap/click. iOS refuses audio that wasn't unlocked inside a user
   * gesture; the SDK's `activateElement` does that for its own hidden media element.
   */
  activate(): void;
  /** Start `uris` on this device from `position`. */
  play(uris: string[], position: number): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  setVolume(v: number): Promise<void>;
}

function loadSdk(): Promise<NonNullable<Window["Spotify"]>> {
  return new Promise((resolve, reject) => {
    if (window.Spotify) return resolve(window.Spotify);
    window.onSpotifyWebPlaybackSDKReady = () => resolve(window.Spotify!);
    const s = document.createElement("script");
    s.src = "https://sdk.scdn.co/spotify-player.js";
    s.async = true;
    s.onerror = () => reject(new Error("could not load the Spotify SDK"));
    document.body.appendChild(s);
  });
}

export const USER_VOLUME = 0.8;

export function useSpotifyDevice(
  clientId: string,
  handlers: {
    onTrackListEnded: () => void;
    /** The current track changed (the SDK plays through the list on its own). */
    onTrackChanged: (uri: string) => void;
    onLost: (message: string) => void;
  },
) {
  const [status, setStatus] = useState<DeviceStatus>({ kind: "idle" });
  const [playback, setPlayback] = useState<Playback | null>(null);
  const player = useRef<SdkPlayer | null>(null);
  const h = useRef(handlers);
  useEffect(() => {
    h.current = handlers;
  });
  // The list we last handed the device, for end-of-list detection.
  const list = useRef<{ last: string; startedAt: number } | null>(null);
  const lastUri = useRef<string | null>(null);
  // pause()/resume() on a player that never loaded a list is a playback_error; gate on this.
  const loaded = useRef(false);

  useEffect(() => () => player.current?.disconnect(), []);

  const connect = useCallback(async () => {
    setStatus({ kind: "connecting" });
    try {
      const Spotify = await loadSdk();
      const p = new Spotify.Player({
        name: "Radio",
        getOAuthToken: (cb) => void accessToken(clientId).then(cb),
        volume: USER_VOLUME,
      });
      p.addListener("ready", (e) => setStatus({ kind: "ready", id: (e as { device_id: string }).device_id }));
      p.addListener("not_ready", () => {
        setStatus({ kind: "error", message: "device went offline" });
        h.current.onLost("the Spotify device went offline");
      });
      for (const ev of ["initialization_error", "authentication_error", "account_error", "playback_error"]) {
        p.addListener(ev, (e) => {
          const message = `${ev}: ${(e as { message: string }).message}`;
          // playback_error is per-operation (a play() that failed surfaces through its own
          // response) — log it, don't stop the station.
          if (ev === "playback_error") console.warn(message);
          else setStatus({ kind: "error", message });
        });
      }
      p.addListener("player_state_changed", (raw) => {
        const s = raw as SdkState | null;
        if (!s) return;
        const cur = s.track_window.current_track?.uri ?? null;
        if (cur && cur !== lastUri.current) {
          lastUri.current = cur;
          h.current.onTrackChanged(cur);
        }
        const t = s.track_window.current_track;
        setPlayback({
          uri: cur,
          paused: s.paused,
          track: t
            ? {
                uri: t.uri,
                name: t.name,
                artists: t.artists.map((a) => a.name),
                album: t.album.name,
                image: [...t.album.images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? null,
              }
            : null,
          position: s.position,
          duration: s.duration,
          at: performance.now(),
        });
        // Spotify signals "list finished" as: paused, at position 0, nothing queued next, and
        // the current track is still the last one we handed it. Ignore the first moments after
        // a play() call, when the state can look the same.
        const l = list.current;
        if (
          l &&
          s.paused &&
          s.position === 0 &&
          s.track_window.next_tracks.length === 0 &&
          lastUri.current === l.last &&
          Date.now() - l.startedAt > 1500
        ) {
          list.current = null;
          h.current.onTrackListEnded();
        }
      });
      if (!(await p.connect())) throw new Error("SDK connect() returned false");
      player.current = p;
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, [clientId]);

  const play = useCallback(
    async (uris: string[], position: number) => {
      if (status.kind !== "ready") throw new Error("no device");
      list.current = { last: uris.at(-1) ?? "", startedAt: Date.now() };
      const token = await accessToken(clientId);
      const res = await fetch(
        `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(status.id)}`,
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ uris, offset: { position } }),
        },
      );
      if (!res.ok) throw new Error(`play failed: ${res.status} ${await res.text()}`);
      loaded.current = true;
    },
    [status, clientId],
  );

  const pause = useCallback(async () => {
    if (loaded.current) await player.current?.pause();
  }, []);
  const resume = useCallback(async () => {
    if (loaded.current) await player.current?.resume();
  }, []);
  const setVolume = useCallback(async (v: number) => player.current?.setVolume(v), []);
  const activate = useCallback(() => {
    void player.current?.activateElement().catch(() => {});
  }, []);

  const device: SpotifyDevice = { status, playback, connect, activate, play, pause, resume, setVolume };
  return device;
}
