"use client";

import type { Track } from "@radio/spotify";
import { useRef, useState } from "react";

/**
 * The browser as the Spotify device. Loads the Web Playback SDK, registers this tab as a
 * Connect device named "Radio", and plays a picked track on it through `/me/player/play`.
 * Tokens come from `/api/spotify/token` (the station's account, refreshed server-side).
 * Note: the SDK only *creates* the device — starting playback is a Web API call with
 * `device_id`, which is why the play button goes through fetch, not the SDK.
 */

interface SpotifyPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: string, cb: (payload: unknown) => void): void;
}

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void;
    Spotify?: {
      Player: new (opts: {
        name: string;
        getOAuthToken: (cb: (token: string) => void) => void;
        volume?: number;
      }) => SpotifyPlayer;
    };
  }
}

const SDK_URL = "https://sdk.scdn.co/spotify-player.js";

async function fetchToken(): Promise<string> {
  const res = await fetch("/api/spotify/token", { cache: "no-store" });
  if (res.status === 401) {
    // Guard token lapsed: a reload sends the browser through Guard and back.
    location.reload();
    throw new Error("guard");
  }
  if (!res.ok) throw new Error(`token ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

/** Load the SDK script once, resolve with the global when it announces itself. */
function loadSdk(): Promise<NonNullable<Window["Spotify"]>> {
  return new Promise((resolve, reject) => {
    if (window.Spotify) return resolve(window.Spotify);
    window.onSpotifyWebPlaybackSDKReady = () => resolve(window.Spotify!);
    const s = document.createElement("script");
    s.src = SDK_URL;
    s.async = true;
    s.onerror = () => reject(new Error("could not load the Spotify SDK"));
    document.body.appendChild(s);
  });
}

type Status =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "ready"; deviceId: string }
  | { kind: "error"; message: string };

export function Player({ tracks, enabled }: { tracks: Track[]; enabled: boolean }) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [nowPlaying, setNowPlaying] = useState<string | null>(null);
  const player = useRef<SpotifyPlayer | null>(null);

  async function connect() {
    setStatus({ kind: "connecting" });
    try {
      const Spotify = await loadSdk();
      const p = new Spotify.Player({
        name: "Radio",
        getOAuthToken: (cb) => void fetchToken().then(cb),
        volume: 0.8,
      });
      p.addListener("ready", (e) =>
        setStatus({ kind: "ready", deviceId: (e as { device_id: string }).device_id }),
      );
      p.addListener("not_ready", () => setStatus({ kind: "error", message: "device went offline" }));
      for (const ev of ["initialization_error", "authentication_error", "account_error", "playback_error"]) {
        p.addListener(ev, (e) =>
          setStatus({ kind: "error", message: `${ev}: ${(e as { message: string }).message}` }),
        );
      }
      p.addListener("player_state_changed", (s) => {
        const st = s as { track_window?: { current_track?: { name: string } } } | null;
        setNowPlaying(st?.track_window?.current_track?.name ?? null);
      });
      if (!(await p.connect())) throw new Error("SDK connect() returned false");
      player.current = p;
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function play(track: Track) {
    if (status.kind !== "ready") return;
    const token = await fetchToken();
    const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${status.deviceId}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ uris: [track.uri] }),
    });
    if (!res.ok) setStatus({ kind: "error", message: `play failed: ${res.status} ${await res.text()}` });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 text-sm">
        {status.kind === "ready" ? (
          <span className="text-green-400">Player ready{nowPlaying ? ` — playing "${nowPlaying}"` : ""}</span>
        ) : (
          <button
            type="button"
            onClick={() => void connect()}
            disabled={!enabled || status.kind === "connecting"}
            className="rounded-md bg-zinc-100 px-3 py-1.5 font-medium text-black disabled:opacity-40"
          >
            {status.kind === "connecting" ? "Connecting…" : "Start player in this tab"}
          </button>
        )}
        {status.kind === "error" && <span className="text-red-400">{status.message}</span>}
        {!enabled && <span className="text-zinc-500">connect a Premium account first</span>}
      </div>
      <ol className="divide-y divide-zinc-800">
        {tracks.map((t) => (
          <li key={t.id} className="flex items-center gap-3 py-2">
            {t.images.at(-1) && (
              // eslint-disable-next-line @next/next/no-img-element -- Spotify CDN, tiny, no optimisation wanted
              <img src={t.images.at(-1)!.url} alt="" width={40} height={40} className="rounded" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{t.name}</div>
              <div className="truncate text-xs text-zinc-500">
                {t.artists.join(", ")} · {t.album} · {Math.round(t.durationMs / 1000)}s
              </div>
            </div>
            <button
              type="button"
              onClick={() => void play(t)}
              disabled={status.kind !== "ready"}
              className="rounded-md border border-zinc-700 px-3 py-1 text-xs disabled:opacity-40"
            >
              Play
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
