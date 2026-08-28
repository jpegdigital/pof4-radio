"use client";

import type { Segment } from "@radio/db";
import { useRef, useState } from "react";
import { requestSegment, segmentPlayed } from "@/app/actions";

/**
 * The browser as the Spotify device, and the station's sequencer.
 *
 * Playing a segment: speak the intro (browser speech synthesis — ElevenLabs replaces this),
 * start the track uris on this device, and when the last one ends speak the outro. The
 * moment a segment starts, if nothing else is ready or queued, the next one is requested
 * with the same listener prompt — the station stays one segment ahead.
 *
 * The SDK only *creates* the device; playback is `PUT /me/player/play?device_id=…` with
 * the token from `/api/spotify/token` (refreshed server-side).
 */

interface SpotifyPlayer {
  connect(): Promise<boolean>;
  addListener(event: string, cb: (payload: unknown) => void): void;
  setVolume(v: number): Promise<void>;
}
interface PlayerState {
  paused: boolean;
  position: number;
  duration: number;
  track_window: { current_track: { uri: string; name: string } | null; next_tracks: unknown[] };
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

async function fetchToken(): Promise<string> {
  const res = await fetch("/api/spotify/token", { cache: "no-store" });
  if (res.status === 401) {
    location.reload(); // Guard lapsed: through Guard and back
    throw new Error("guard");
  }
  if (!res.ok) throw new Error(`token ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
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

/** Speak a line and resolve when it's done (or immediately if the browser can't). */
function speak(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}

type Device =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "ready"; id: string }
  | { kind: "error"; message: string };
type OnAir = { segment: Segment; phase: "intro" | "tracks" | "outro" } | null;

const statusLabel: Record<Segment["status"], string> = {
  queued: "queued",
  planning: "the DJ is planning…",
  ready: "ready",
  played: "played",
  failed: "failed",
};

export function Player({ segments, enabled }: { segments: Segment[]; enabled: boolean }) {
  const [device, setDevice] = useState<Device>({ kind: "idle" });
  const [onAir, setOnAir] = useState<OnAir>(null);
  const [error, setError] = useState<string | null>(null);
  const player = useRef<SpotifyPlayer | null>(null);
  const onAirRef = useRef<OnAir>(null);
  const lastUri = useRef<string | null>(null);
  const ended = useRef<(() => void) | null>(null);

  const setAir = (s: OnAir) => {
    onAirRef.current = s;
    setOnAir(s);
  };

  async function connect() {
    setDevice({ kind: "connecting" });
    try {
      const Spotify = await loadSdk();
      const p = new Spotify.Player({
        name: "Radio",
        getOAuthToken: (cb) => void fetchToken().then(cb),
        volume: 0.8,
      });
      p.addListener("ready", (e) => setDevice({ kind: "ready", id: (e as { device_id: string }).device_id }));
      p.addListener("not_ready", () => setDevice({ kind: "error", message: "device went offline" }));
      for (const ev of ["initialization_error", "authentication_error", "account_error", "playback_error"]) {
        p.addListener(ev, (e) =>
          setDevice({ kind: "error", message: `${ev}: ${(e as { message: string }).message}` }),
        );
      }
      p.addListener("player_state_changed", (raw) => {
        const s = raw as PlayerState | null;
        if (!s || onAirRef.current?.phase !== "tracks") return;
        const cur = s.track_window.current_track?.uri ?? null;
        if (cur) lastUri.current = cur;
        // Spotify signals "list finished" as: paused, at position 0, nothing queued next, and
        // the current track is still the last one we handed it.
        const last = onAirRef.current.segment.tracks.at(-1)?.uri;
        if (
          s.paused &&
          s.position === 0 &&
          s.track_window.next_tracks.length === 0 &&
          lastUri.current === last
        ) {
          ended.current?.();
        }
      });
      if (!(await p.connect())) throw new Error("SDK connect() returned false");
      player.current = p;
    } catch (err) {
      setDevice({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function playSegment(seg: Segment) {
    if (device.kind !== "ready" || onAirRef.current) return;
    setError(null);
    setAir({ segment: seg, phase: "intro" });

    // Stay one ahead: ask for the next segment now if nothing is in flight.
    const inFlight = segments.some(
      (s) => s.id !== seg.id && (s.status === "queued" || s.status === "planning" || s.status === "ready"),
    );
    if (!inFlight) void requestSegment(seg.listenerPrompt).catch(() => {});

    try {
      if (seg.intro) await speak(seg.intro);
      setAir({ segment: seg, phase: "tracks" });
      lastUri.current = null;
      const token = await fetchToken();
      const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${device.id}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ uris: seg.tracks.map((t) => t.uri) }),
      });
      if (!res.ok) throw new Error(`play failed: ${res.status} ${await res.text()}`);
      await new Promise<void>((resolve) => {
        ended.current = resolve;
      });
      ended.current = null;
      setAir({ segment: seg, phase: "outro" });
      if (seg.outro) await speak(seg.outro);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      await segmentPlayed(seg.id).catch(() => {});
      setAir(null);
    }
  }

  const next = segments.filter((s) => s.status === "ready").at(-1); // oldest ready

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {device.kind === "ready" ? (
          <span className="text-green-400">Player ready</span>
        ) : (
          <button
            type="button"
            onClick={() => void connect()}
            disabled={!enabled || device.kind === "connecting"}
            className="rounded-md bg-zinc-100 px-3 py-1.5 font-medium text-black disabled:opacity-40"
          >
            {device.kind === "connecting" ? "Connecting…" : "Start player in this tab"}
          </button>
        )}
        {device.kind === "ready" && next && !onAir && (
          <button
            type="button"
            onClick={() => void playSegment(next)}
            className="rounded-md bg-green-500 px-3 py-1.5 font-medium text-black"
          >
            Play next segment
          </button>
        )}
        {onAir && (
          <span className="text-zinc-300">
            {onAir.phase === "tracks" ? "Playing" : `DJ ${onAir.phase}`} · {onAir.segment.tracks.length}{" "}
            tracks
          </span>
        )}
        {device.kind === "error" && <span className="text-red-400">{device.message}</span>}
        {error && <span className="text-red-400">{error}</span>}
        {!enabled && <span className="text-zinc-500">connect a Premium account first</span>}
      </div>

      <ol className="flex flex-col gap-3">
        {segments.map((s) => (
          <li
            key={s.id}
            className={`rounded-lg border p-3 ${onAir?.segment.id === s.id ? "border-green-500" : "border-zinc-800"}`}
          >
            <div className="mb-1 flex items-baseline justify-between gap-3 text-xs text-zinc-500">
              <span className="truncate">“{s.listenerPrompt}”</span>
              <span
                className={
                  s.status === "failed" ? "text-red-400" : s.status === "ready" ? "text-green-400" : ""
                }
              >
                {statusLabel[s.status]}
              </span>
            </div>
            {s.intro && <p className="mb-2 text-sm italic text-zinc-300">{s.intro}</p>}
            {s.tracks.length > 0 && (
              <ul className="mb-2 text-sm">
                {s.tracks.map((t) => (
                  <li key={t.id} className="truncate">
                    {t.artists.join(", ")} — {t.name}{" "}
                    <span className="text-zinc-500">· {Math.round(t.durationMs / 1000)}s</span>
                  </li>
                ))}
              </ul>
            )}
            {s.outro && <p className="text-sm italic text-zinc-400">{s.outro}</p>}
            {s.error && <p className="text-sm text-red-400">{s.error}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}
