"use client";

import { LogOut, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { keepGuardAlive } from "@/lib/guard-client";
import { DjPicker } from "./dj-picker";
import { Player, type PlayerFace } from "./player";
import { awaiting, inGap, nextRecord, onAir, type ProgramEvent, segmentAt } from "./reducer";
import { ResumePicker, type StationSummary } from "./resume-picker";
import { Rundown } from "./rundown";
import type { SpotifyAccount, SpotifyIdentity } from "./spotify-account";
import { Card, focusRing, Label, SpotifyMark } from "./ui";
import { useMediaSession } from "./use-media-session";
import { useProgram } from "./use-program";
import { useSpotifyDevice } from "./use-spotify-device";
import { type Dj, findDj, loadDj, saveDj } from "./voice-store";

/** Prev on a song this far in restarts it instead (the Spotify convention). */
const RESTART_AFTER_MS = 3000;

/**
 * The station, on one page: on air (the lamp and the one button, the DJ, the account), the
 * request, the player, the rundown. The browser is the whole state machine — nothing happens
 * when this component isn't running; the server produces one segment when asked.
 */
export function Station({
  clientId,
  identity,
  djs,
  stations,
  account,
  onConnect,
  onDisconnect,
}: {
  clientId: string;
  /** The roster, in picker order; the first is the default. */
  djs: readonly Dj[];
  /** Past shows to resume, most recent first. */
  stations: readonly StationSummary[];
  /** Who is connected — on the page from the first paint (the identity cookie). */
  identity: SpotifyIdentity | null;
  /** The connected account with its tokens — from localStorage, a frame later. Gates going on air. */
  account: SpotifyAccount | null;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const premium = identity?.product === "premium";
  /** Going on air needs the tokens loaded, not just the name. */
  const enabled = premium && account !== null;
  const [prompt, setPrompt] = useState("");
  const [dj, setDj] = useState<Dj>(() => findDj(djs, ""));
  const promptRef = useRef(prompt);
  useEffect(() => {
    promptRef.current = prompt;
  }, [prompt]);

  const dispatchRef = useRef<(e: ProgramEvent) => void>(() => {});
  const device = useSpotifyDevice(clientId, {
    onTrackListEnded: () => dispatchRef.current({ type: "TRACK_ENDED" }),
    onTrackChanged: () => {},
    onLost: (error) => dispatchRef.current({ type: "HALT", error }),
  });

  const { state, dispatch, station, clips, micClock, unlock, seekMic, open, resume, clear } = useProgram({
    device,
    dj,
    getPrompt: () => promptRef.current,
  });
  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  // The roster arrives with the page; the pick is remembered per browser and applied after
  // hydration, so the first paint shows the default and the remembered DJ takes over at once.
  // The station is not remembered: a page load is a fresh show unless one is picked below.
  useEffect(() => {
    const stored = loadDj(djs);
    queueMicrotask(() => setDj(stored)); // after hydration, not during it
  }, [djs]);

  // The Guard cookie lasts 15 minutes; a show lasts hours. Keep it fresh without reloading.
  useEffect(keepGuardAlive, []);

  const changeDj = (d: Dj) => {
    setDj(d);
    saveDj(d);
  };

  const ready = device.status.kind === "ready";
  const running = state.loop === "running";
  const fresh = !running && state.segments.length === 0 && !state.producing;
  const requestBox = useRef<HTMLTextAreaElement>(null);
  const [needRequest, setNeedRequest] = useState(false);

  // "Go on air" is one tap even when this tab isn't the Spotify device yet: it registers the tab
  // and runs the moment the device is ready. The unlock/activate calls must stay inside the tap.
  const arming = device.status.kind === "connecting";
  /** What to dispatch the moment the tab becomes the device: Run from the button, or the row tapped. */
  const armed = useRef<ProgramEvent | null>(null);
  const arm = (e: ProgramEvent) => {
    armed.current = e;
    void device.connect();
  };
  const goOnAir = () => {
    if (!station && prompt.trim() === "") {
      // Not a disabled button: the tap says what's missing and puts the cursor there.
      setNeedRequest(true);
      requestBox.current?.focus();
      return;
    }
    unlock();
    device.activate();
    // A fresh page: the request becomes a station; the show goes on air into the gap meanwhile.
    if (!station) void open(prompt.trim());
    if (ready) dispatch({ type: "RUN" });
    else arm({ type: "RUN" });
  };
  const jump = (index: number) => {
    unlock();
    device.activate();
    if (ready) dispatch({ type: "JUMP", index });
    else arm({ type: "JUMP", index });
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

  // Resume a past show: everything kept loads at once; tap any row, or go on air from the top.
  const pick = async (id: string) => {
    const info = await resume(id);
    if (info) setPrompt(info.prompt);
  };

  const el = onAir(state);
  const cursor = state.cursor;
  const seg = segmentAt(state, cursor);
  const talking = running && state.mic !== null;
  const gap = inGap(state);

  const face: PlayerFace | null = (() => {
    if (gap && awaiting(state) && state.music.level === "off") return { kind: "planning", dj: dj.name };
    if (gap) {
      const r = nextRecord(state);
      if (r)
        return {
          kind: "track",
          name: r.name,
          artists: r.artists,
          album: r.album,
          image: r.image,
          playback: trackClock(r.uri, r.durationMs),
        };
    }
    if (!el) return null;
    if (el.kind === "break") {
      return {
        kind: "talk",
        dj: dj.name,
        initial: dj.name.charAt(0).toUpperCase(),
        seq: seg?.seq ?? 0,
        excerpt: el.label,
        playback: !running
          ? { paused: true, position: 0, duration: 0, at: 0 }
          : micClock && micClock.duration > 0
            ? micClock
            : null,
      };
    }
    return {
      kind: "track",
      name: el.track.name,
      artists: el.track.artists,
      album: el.track.album,
      image: el.track.image,
      playback: trackClock(el.track.uri, el.track.durationMs),
    };
  })();

  function trackClock(uri: string, durationMs: number) {
    const p = device.playback;
    const live = p?.uri === uri ? p : null;
    return live
      ? { paused: live.paused, position: live.position, duration: live.duration, at: live.at }
      : { paused: true, position: 0, duration: durationMs, at: 0 };
  }

  const status = (() => {
    if (!running) return state.segments.length > 0 ? "Stopped" : "Off air";
    if (gap) return awaiting(state) ? "The DJ is producing…" : "On air";
    if (el?.kind === "break") return el.label.split(" → ")[0] ?? "Break";
    if (seg && cursor !== null) {
      const songs = state.elements.slice(seg.from, seg.to);
      const n = songs.slice(0, cursor - seg.from + 1).filter((e) => e.kind === "song").length;
      return `Song ${n} of ${songs.filter((e) => e.kind === "song").length}${talking ? " · talk-up" : ""}`;
    }
    return "On air";
  })();

  // The transport. A break's clip and a song are the same three buttons; only what they touch differs.
  const toggle = useCallback(() => {
    if (!running) return;
    if (state.mic && el?.kind === "break") {
      const paused = micClock?.paused ?? true;
      if (paused) seekMic(micClock?.position ?? 0);
      return; // the voice element has no pause here: the clip plays through (seek restarts it)
    }
    void (device.playback?.paused ? device.resume() : device.pause()).catch(() => {});
  }, [running, state.mic, el, micClock, seekMic, device]);
  const prev = useCallback(() => {
    if (cursor === null) return;
    const p = device.playback;
    const pos = p ? (p.paused ? p.position : p.position + (performance.now() - p.at)) : 0;
    if (el?.kind === "song" && pos > RESTART_AFTER_MS) dispatch({ type: "JUMP", index: cursor });
    else dispatch({ type: "PREV" });
  }, [cursor, el, device.playback, dispatch]);
  const next = useCallback(() => dispatch({ type: "NEXT" }), [dispatch]);

  const canPrev = cursor !== null && cursor > 0;
  const canNext = cursor !== null && !gap;
  useMediaSession({ face, running, canPrev, canNext, onToggle: toggle, onPrev: prev, onNext: next });

  return (
    <>
      {/* the desk, one card: indicators · the request · who's on the mic and the one button */}
      <Card className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className={`lamp size-2.5 rounded-full ${running ? "on" : ""} ${talking ? "talking" : ""}`}
            />
            <Label className={running ? "text-lamp" : ""}>{running ? "On air" : "Off air"}</Label>
          </div>
          {identity ? (
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <SpotifyMark className="size-4 shrink-0 text-[#1DB954]" />
              <span className="truncate text-zinc-300">{identity.displayName ?? identity.spotifyUserId}</span>
              {!premium && <span className="shrink-0 text-xs text-amber-300/90">not Premium</span>}
              <button
                type="button"
                onClick={onDisconnect}
                aria-label="Sign out of Spotify"
                title="Sign out of Spotify"
                className={`-mr-1.5 rounded-full p-1.5 text-zinc-500 transition hover:text-zinc-200 ${focusRing}`}
              >
                <LogOut className="size-4" strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onConnect}
              className={`flex items-center gap-2 rounded-full bg-[#1DB954] px-3.5 py-1.5 text-xs font-semibold text-black transition hover:bg-[#1ed760] ${focusRing}`}
            >
              <SpotifyMark className="size-3.5" />
              Connect
            </button>
          )}
        </div>

        {/* the request: 16px so iOS doesn't zoom the page when it's tapped */}
        <textarea
          ref={requestBox}
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            if (needRequest && e.target.value.trim() !== "") setNeedRequest(false);
          }}
          placeholder="What do you want to hear tonight? e.g. Saturday night 80s, hits-forward, keep it warm"
          maxLength={500}
          rows={3}
          aria-label="The request"
          className={`w-full resize-none rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-3 font-mono text-base leading-relaxed placeholder:text-zinc-600 ${focusRing}`}
        />
        {needRequest && prompt.trim() === "" && (
          <p className="-mt-2 text-xs text-lamp">Tell the DJ what you want to hear first.</p>
        )}
        {station && prompt.trim() !== "" && prompt.trim() !== station.prompt && (
          <p className="-mt-2 text-xs text-zinc-500">The new request reaches the DJ on the next segment.</p>
        )}
        {!identity && (
          <p className="-mt-2 text-xs text-zinc-500">Playback needs a Spotify Premium account.</p>
        )}
        {device.status.kind === "error" && (
          <p className="-mt-2 text-xs text-red-400">
            This tab couldn&rsquo;t become the player: {device.status.message}
          </p>
        )}
        {fresh && !station && <ResumePicker stations={stations} onPick={(id) => void pick(id)} />}
        {!running && station && cursor === null && state.segments.length > 0 && (
          <p className="text-xs text-zinc-500">
            Resuming ({state.segments.length} segment{state.segments.length === 1 ? "" : "s"}, {station.dj} on
            the mic) — tap a row, or go on air.{" "}
            <button
              type="button"
              onClick={clear}
              className="underline underline-offset-2 hover:text-zinc-300"
            >
              Start fresh
            </button>
          </p>
        )}

        <div className="flex items-end gap-3 pt-2">
          {/* the voice field, its name on a plate riding the top-left of the bezel — the way a
              console labels a control: on it, not near it. Lit while the DJ is actually talking. */}
          <div className="relative min-w-0 flex-1">
            <DjPicker djs={djs} value={dj} onChange={changeDj} />
            <span
              aria-hidden="true"
              className={`absolute -top-[11px] left-3 rounded-[3px] px-1.5 py-px font-display text-[10px] font-semibold uppercase tracking-[0.22em] transition ${
                talking ? "bg-lamp text-black" : "bg-zinc-800 text-zinc-400"
              }`}
            >
              On the mic
            </span>
          </div>
          {running ? (
            <button
              type="button"
              onClick={() => dispatch({ type: "STOP" })}
              className={`flex h-11 shrink-0 items-center gap-2 rounded-full bg-zinc-100 px-5 text-sm font-semibold text-black transition hover:bg-white ${focusRing}`}
            >
              <Square className="size-3.5" fill="currentColor" strokeWidth={0} aria-hidden="true" />
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={goOnAir}
              disabled={!enabled || arming}
              className={`h-11 shrink-0 rounded-full bg-lamp px-5 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100 ${focusRing}`}
            >
              {arming ? "Activating…" : "Go on air"}
            </button>
          )}
        </div>
      </Card>

      {state.error && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
          <span>{state.error}</span>
          <button
            type="button"
            onClick={() => dispatch({ type: "CLEAR_ERROR" })}
            aria-label="Dismiss"
            className="text-red-400"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* the player: mounted from the first element on, never unmounts */}
      {face && (
        <Card className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <Label>Now playing</Label>
            <span className={`text-xs ${running ? "text-zinc-300" : "text-zinc-500"}`}>{status}</span>
          </div>
          <Player
            face={face}
            running={running}
            canPrev={canPrev}
            canNext={canNext}
            onPrev={prev}
            onNext={next}
            onToggle={toggle}
          />
        </Card>
      )}

      {/* the show as produced */}
      <Rundown state={state} clips={clips} onJump={jump} />
    </>
  );
}
