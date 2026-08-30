"use client";

import { useEffect, useRef, useState } from "react";
import {
  beginLogin,
  clearAccount,
  identityOf,
  loadAccount,
  rememberIdentity,
  type SpotifyAccount,
  type SpotifyIdentity,
} from "@/components/station/spotify-account";
import { useSpotifyDevice } from "@/components/station/use-spotify-device";
import Link from "next/link";
import { type Program as ProgramFile, Program as ProgramShape } from "./make/shapes";
import { PROGRAM_START_MS, PROGRAM_URL } from "./manifest";
import type { ProgramEvent } from "./reducer";
import { type Seek, Timeline } from "./timeline";
import { useProgram } from "./use-program";

/**
 * The program page. Owns this browser's Spotify account (the same shape as the station's
 * home.tsx), fetches the manifest, and hands both to the desk.
 */
export function Program({
  clientId,
  identity: initialIdentity,
}: {
  clientId: string;
  identity: SpotifyIdentity | null;
}) {
  const [identity, setIdentity] = useState(initialIdentity);
  const [account, setAccount] = useState<SpotifyAccount | null>(null);
  useEffect(() => {
    const stored = loadAccount();
    queueMicrotask(() => {
      // after hydration, not during it
      setAccount(stored);
      if (stored) {
        setIdentity(identityOf(stored));
        if (!initialIdentity) rememberIdentity(stored);
      } else if (initialIdentity) {
        clearAccount();
        setIdentity(null);
      }
    });
  }, [initialIdentity]);

  const [program, setProgram] = useState<ProgramFile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    fetch(PROGRAM_URL, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`program.json ${r.status}`))))
      .then((j) => {
        const p = ProgramShape.safeParse(j);
        if (!p.success) throw new Error(`program.json: ${p.error.issues[0]?.message ?? "invalid"}`);
        setProgram(p.data);
      })
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  if (loadError) {
    return (
      <p className="text-sm text-red-400">
        No program to play ({loadError}). Make one on{" "}
        <Link href="/program/make" className="underline">
          /program/make
        </Link>
        .
      </p>
    );
  }
  if (!program) return <p className="text-sm text-zinc-500">Loading the program…</p>;
  return (
    <Desk
      clientId={clientId}
      program={program}
      identity={identity}
      account={account}
      onConnect={() => void beginLogin(clientId)}
    />
  );
}

function Desk({
  clientId,
  program,
  identity,
  account,
  onConnect,
}: {
  clientId: string;
  program: ProgramFile;
  identity: SpotifyIdentity | null;
  account: SpotifyAccount | null;
  onConnect: () => void;
}) {
  const { elements } = program;
  const dispatchRef = useRef<(e: ProgramEvent) => void>(() => {});
  const device = useSpotifyDevice(clientId, {
    onTrackListEnded: () => dispatchRef.current({ type: "TRACK_ENDED" }),
    onTrackChanged: () => {},
    onLost: (error) => dispatchRef.current({ type: "HALT", error }),
  });
  const { state, dispatch, clips, micClock, unlock, seekMic } = useProgram({ device, elements });
  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  const ready = device.status.kind === "ready";
  const running = state.loop === "running";
  const premium = identity?.product === "premium" && account !== null;

  // One tap even when this tab isn't the device yet: register, then dispatch when ready.
  // The unlock/activate calls must stay inside the tap.
  const armed = useRef<ProgramEvent | null>(null);
  const go = (e: ProgramEvent) => {
    unlock();
    device.activate();
    if (ready) {
      dispatch(e);
      return;
    }
    armed.current = e;
    void device.connect();
  };
  useEffect(() => {
    const e = armed.current;
    if (!e) return;
    if (ready) {
      armed.current = null;
      dispatch(e);
    } else if (device.status.kind === "error") {
      armed.current = null;
    }
  }, [ready, device.status.kind, dispatch]);

  // A scrub on the row on air seeks at once; on another row it goes there first, and the seek
  // lands as soon as that lane is playing (the device reports the uri; the mic reports a clock).
  const pendingSeek = useRef<Seek | null>(null);
  const seek = (sk: Seek) => {
    if (running && state.cursor === sk.index) {
      if (sk.lane === "music") void device.seek(sk.ms).catch(() => {});
      else seekMic(sk.ms);
      return;
    }
    pendingSeek.current = sk;
    go({ type: "JUMP", index: sk.index });
  };
  const playingUri = device.playback && !device.playback.paused ? device.playback.uri : null;
  const micUp = micClock !== null && !micClock.paused;
  useEffect(() => {
    const sk = pendingSeek.current;
    if (!sk || state.cursor !== sk.index) return;
    if (sk.lane === "music" && playingUri && playingUri === state.music.uri) {
      pendingSeek.current = null;
      void device.seek(sk.ms).catch(() => {});
    } else if (sk.lane === "mic" && micUp) {
      pendingSeek.current = null;
      seekMic(sk.ms);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.cursor, state.music.uri, playingUri, micUp]);

  const clock = useProgramClock(state.startedAt, running);

  return (
    <>
      <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <span
          aria-hidden="true"
          className={`lamp ${running ? "on" : ""} ${state.mic ? "talking" : ""} size-3 rounded-full`}
        />
        <span className="font-display text-4xl font-semibold tabular-nums tracking-wider">{clock}</span>
        <span className="text-sm text-zinc-400">{program.dj} on the mic</span>
        <span className="flex-1" />
        {identity ? (
          <span className="truncate text-sm text-zinc-400">
            {identity.displayName ?? identity.spotifyUserId}
          </span>
        ) : (
          <button
            type="button"
            onClick={onConnect}
            className="rounded-full bg-[#1DB954] px-4 py-1.5 text-sm font-medium text-black transition hover:brightness-110"
          >
            Connect Spotify
          </button>
        )}
        {identity && !premium && (
          <span className="text-sm text-zinc-500">Playback needs Spotify Premium.</span>
        )}
        {running ? (
          <button
            type="button"
            onClick={() => dispatch({ type: "STOP" })}
            className="rounded-full bg-zinc-100 px-5 py-2 font-medium text-black transition hover:bg-white"
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            disabled={!premium}
            onClick={() => go({ type: "RUN" })}
            className="rounded-full bg-lamp px-5 py-2 font-medium text-black transition hover:brightness-110 disabled:opacity-40"
          >
            {device.status.kind === "connecting" ? "Connecting…" : "Run"}
          </button>
        )}
      </section>
      {state.error && <p className="text-sm text-red-400">{state.error}</p>}
      {device.status.kind === "error" && <p className="text-sm text-red-400">{device.status.message}</p>}
      <Timeline
        elements={elements}
        notes={program.notes}
        state={state}
        clips={clips}
        micClock={micClock}
        playback={device.playback}
        onJump={(index) => go({ type: "JUMP", index })}
        onSeek={seek}
      />
    </>
  );
}

/** "8:43:12" — the program's clock, running from PROGRAM_START_MS since RUN was first pressed. */
function useProgramClock(startedAt: number | null, live: boolean): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live]);
  const ms = PROGRAM_START_MS + (startedAt === null || !live ? 0 : now - startedAt);
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600) % 12 || 12;
  return `${h}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
