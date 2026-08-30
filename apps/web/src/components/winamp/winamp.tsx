"use client";

import { useEffect, useRef, useState } from "react";
import { keepGuardAlive } from "@/lib/guard-client";
import type { PlayerFace } from "../station/player";
import { ahead, awaiting, inGap, nextRecord, onAir, type ProgramEvent, segmentAt } from "../station/reducer";
import type { StationSummary } from "../station/resume-picker";
import {
  beginLogin,
  clearAccount,
  identityOf,
  loadAccount,
  rememberIdentity,
  type SpotifyAccount,
  type SpotifyIdentity,
} from "../station/spotify-account";
import { useMediaSession } from "../station/use-media-session";
import { useProgram } from "../station/use-program";
import { USER_VOLUME, useSpotifyDevice } from "../station/use-spotify-device";
import { type Dj, findDj, loadDj, saveDj } from "../station/voice-store";
import { type MainClock, MainWindow } from "./main-window";
import { PlaylistWindow } from "./playlist-window";
import { MAIN, SKIN } from "./skin";
import { useZoom } from "./use-zoom";

/**
 * The station wearing a Winamp skin. Same machinery as the home page — the account, the
 * browser as the Spotify device, the loop (use-program), the lock screen — with the skin's two
 * windows as the face: the main window is the transport (Play is "go on air" when off air),
 * the playlist is the show, and the request console is the head of the playlist.
 */
export function Winamp({
  clientId,
  identity: initialIdentity,
  djs,
  stations,
}: {
  clientId: string;
  identity: SpotifyIdentity | null;
  djs: Dj[];
  stations: StationSummary[];
}) {
  // the account, as home.tsx keeps it
  const [identity, setIdentity] = useState(initialIdentity);
  const [account, setAccount] = useState<SpotifyAccount | null>(null);
  useEffect(() => {
    const stored = loadAccount();
    queueMicrotask(() => {
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
  const disconnect = () => {
    clearAccount();
    setAccount(null);
    setIdentity(null);
  };

  const premium = identity?.product === "premium";
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
  const {
    state,
    dispatch,
    station,
    micClock,
    unlock,
    seekMic,
    open,
    resume: resumeStation,
    clear,
  } = useProgram({
    device,
    dj,
    getPrompt: () => promptRef.current,
  });
  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  useEffect(() => {
    const stored = loadDj(djs);
    queueMicrotask(() => setDj(stored));
  }, [djs]);
  useEffect(keepGuardAlive, []);

  const resume = async (id: string) => {
    const info = await resumeStation(id);
    if (info) setPrompt(info.prompt);
  };

  const ready = device.status.kind === "ready";
  const running = state.loop === "running";
  const fresh = !running && state.segments.length === 0 && !state.producing;
  const requestBox = useRef<HTMLTextAreaElement>(null);
  const [needRequest, setNeedRequest] = useState(false);
  const arming = device.status.kind === "connecting";
  const armed = useRef<ProgramEvent | null>(null);
  const arm = (e: ProgramEvent) => {
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

  const goOnAir = () => {
    if (!station && prompt.trim() === "") {
      setNeedRequest(true);
      requestBox.current?.focus();
      return;
    }
    unlock();
    device.activate();
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

  const el = onAir(state);
  const cursor = state.cursor;
  const seg = segmentAt(state, cursor);
  const talking = running && state.mic !== null;
  const gap = inGap(state);
  const trackClock = (uri: string, durationMs: number) => {
    const p = device.playback;
    const live = p?.uri === uri ? p : null;
    return live
      ? { paused: live.paused, position: live.position, duration: live.duration, at: live.at }
      : { paused: true, position: 0, duration: durationMs, at: 0 };
  };

  // The face, as the home page builds it — the lock screen reads it, and the skin is cut from it.
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
  const toggle = () => {
    if (!running) return;
    if (state.mic && el?.kind === "break") {
      if (micClock?.paused) seekMic(micClock.position);
      return;
    }
    void (device.playback?.paused ? device.resume() : device.pause()).catch(() => {});
  };
  const prev = () => dispatch({ type: "PREV" }); // Winamp's Play is the restart; Prev always goes back
  const next = () => dispatch({ type: "NEXT" });
  const canPrev = cursor !== null && cursor > 0;
  const canNext = cursor !== null && !gap;
  useMediaSession({ face, running, canPrev, canNext, onToggle: toggle, onPrev: prev, onNext: next });

  // What the main window shows.
  const clock: MainClock | null = running && face && face.kind !== "planning" ? face.playback : null;
  const indicator = !running ? "stopped" : clock ? (clock.paused ? "paused" : "playing") : "playing";
  const marquee = (() => {
    if (!running) {
      if (arming) return "activating this tab as the player...";
      return state.segments.length > 0 ? "claude radio - stopped" : "claude radio - off air";
    }
    if (!face || face.kind === "planning") return `${dj.name} is producing the segment...`;
    if (face.kind === "talk") return `${face.seq}. ${face.dj} on the mic - ${face.excerpt.toLowerCase()}`;
    const n = cursor === null ? 0 : cursor + 1;
    return `${n}. ${face.artists.join(", ")} - ${face.name} (${fmt(face.playback.duration)})`;
  })();

  const play = () => {
    if (!running) {
      goOnAir();
      return;
    }
    if (clock?.paused) toggle();
    else if (cursor !== null && !gap) dispatch({ type: "JUMP", index: cursor }); // Winamp's Play restarts the track
  };
  const eject = () => requestBox.current?.focus();

  const fit = useZoom(MAIN.width);
  const rootStyle = {
    "--wa-normal": SKIN.text.normal,
    "--wa-current": SKIN.text.current,
    "--wa-bg": SKIN.text.normalBg,
    "--wa-sel": SKIN.text.selectedBg,
    "--wa-font": SKIN.text.font,
    zoom: fit?.zoom ?? 1,
    height: fit?.height ?? "100dvh",
    visibility: fit ? "visible" : "hidden",
  } as React.CSSProperties;

  return (
    <div className="wa-root" style={rootStyle}>
      <MainWindow
        marquee={marquee}
        clock={clock}
        indicator={indicator}
        talk={talking}
        volume={USER_VOLUME}
        onPrev={prev}
        onPlay={play}
        onPause={toggle}
        onStop={() => dispatch({ type: "STOP" })}
        onNext={next}
        onEject={eject}
      />
      <PlaylistWindow
        elements={state.elements}
        ahead={ahead(state)}
        cursor={cursor}
        dj={dj.name}
        onJump={jump}
        header={
          <div className="wa-console">
            <textarea
              ref={requestBox}
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                if (needRequest && e.target.value.trim() !== "") setNeedRequest(false);
              }}
              placeholder="what do you want to hear tonight?"
              maxLength={500}
              rows={2}
              aria-label="The request"
            />
            {needRequest && prompt.trim() === "" && (
              <div className="wa-err">tell the DJ what you want to hear first</div>
            )}
            {station && prompt.trim() !== "" && prompt.trim() !== station.prompt && (
              <div className="wa-dim">the new request reaches the DJ on the next segment</div>
            )}
            <div className="wa-console-row">
              <span className="wa-dim">DJ</span>
              <select
                value={dj.id}
                disabled={!djs[0]}
                aria-label="DJ"
                onChange={(e) => {
                  const d = findDj(djs, e.target.value);
                  setDj(d);
                  saveDj(d);
                }}
              >
                {djs.length === 0 && <option value="">{dj.name}</option>}
                {djs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              {identity ? (
                <>
                  <span className="wa-ellipsis" style={{ maxWidth: 80 }}>
                    {identity.displayName ?? identity.spotifyUserId}
                    {!premium && <span className="wa-err"> (not premium)</span>}
                  </span>
                  <button type="button" className="wa-cbtn" onClick={disconnect}>
                    sign out
                  </button>
                </>
              ) : (
                <button type="button" className="wa-cbtn" onClick={() => void beginLogin(clientId)}>
                  connect spotify
                </button>
              )}
            </div>
            {!identity && <div className="wa-dim">playback needs a Spotify Premium account</div>}
            {identity && !enabled && !premium && <div className="wa-err">playback needs Premium</div>}
            {device.status.kind === "error" && (
              <div className="wa-err">this tab couldn&rsquo;t become the player: {device.status.message}</div>
            )}
            {state.error && (
              <div className="wa-console-row">
                <span className="wa-err wa-ellipsis" style={{ flex: 1 }}>
                  {state.error}
                </span>
                <button type="button" className="wa-link" onClick={() => dispatch({ type: "CLEAR_ERROR" })}>
                  ok
                </button>
              </div>
            )}
            {fresh && !station && stations.length > 0 && (
              <div className="wa-console-row">
                <span className="wa-dim">resume</span>
                <select
                  defaultValue=""
                  aria-label="Resume a show"
                  onChange={(e) => e.target.value && void resume(e.target.value)}
                >
                  <option value="">a past show...</option>
                  {stations.map((s) => (
                    <option key={s.stationId} value={s.stationId}>
                      {when(s.updatedAt)} · {s.dj} · {s.segmentCount} segment{s.segmentCount === 1 ? "" : "s"}{" "}
                      · {s.prompt}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {!running && station && cursor === null && state.segments.length > 0 && (
              <div className="wa-dim">
                resuming ({state.segments.length} segment{state.segments.length === 1 ? "" : "s"}) — tap a
                line, or press play.{" "}
                <button type="button" className="wa-link" onClick={clear}>
                  start fresh
                </button>
              </div>
            )}
            {!running && !arming && <div className="wa-dim">{enabled ? "press play to go on air" : ""}</div>}
          </div>
        }
      />
    </div>
  );
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
