"use client";

import { useEffect, useRef, useState } from "react";
import { guarded, keepGuardAlive } from "@/lib/guard-client";
import type { PlayerFace } from "../station/player";
import { cursorSegment, type SegmentView, type StationEvent } from "../station/reducer";
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
import { USER_VOLUME, useSpotifyDevice } from "../station/use-spotify-device";
import { useStation } from "../station/use-station";
import { type Dj, findDj, loadDj, saveDj } from "../station/voice-store";
import { type MainClock, MainWindow } from "./main-window";
import { firstSentence, PlaylistWindow } from "./playlist-window";
import { MAIN, SKIN } from "./skin";
import { useZoom } from "./use-zoom";

/**
 * The station wearing a Winamp skin. Same machinery as the home page — the account, the
 * browser as the Spotify device, the loop (use-station), the lock screen — with the skin's two
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
  const [stationId, setStationId] = useState<string | null>(null);
  const promptRef = useRef(prompt);
  useEffect(() => {
    promptRef.current = prompt;
  }, [prompt]);

  const dispatchRef = useRef<(e: StationEvent) => void>(() => {});
  const device = useSpotifyDevice(clientId, {
    onTrackListEnded: () => dispatchRef.current({ type: "ENDED" }),
    onTrackChanged: (uri) => dispatchRef.current({ type: "TRACK_CHANGED", uri }),
    onLost: (error) => dispatchRef.current({ type: "HALT", error }),
  });
  const { state, dispatch, talkPlayback, toggle, prev, next, unlock } = useStation({
    device,
    stationId,
    dj,
    getPrompt: () => promptRef.current,
    onStation: setStationId,
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
    const res = await guarded(`/api/station/${id}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { stationId: string; prompt: string; segments: SegmentView[] };
    setStationId(data.stationId);
    setPrompt(data.prompt);
    dispatch({ type: "LOAD_SHOW", segments: [...data.segments].sort((a, b) => a.seq - b.seq) });
  };

  const ready = device.status.kind === "ready";
  const running = state.loop === "running";
  const fresh = !running && state.segments.length === 0;
  const requestBox = useRef<HTMLTextAreaElement>(null);
  const [needRequest, setNeedRequest] = useState(false);
  const arming = device.status.kind === "connecting";
  const armed = useRef<StationEvent | null>(null);
  const arm = (e: StationEvent) => {
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
    if (prompt.trim() === "") {
      setNeedRequest(true);
      requestBox.current?.focus();
      return;
    }
    unlock();
    device.activate();
    if (ready) dispatch({ type: "RUN" });
    else arm({ type: "RUN" });
  };
  const jump = (seg: number, item: number) => {
    unlock();
    device.activate();
    if (ready) dispatch({ type: "JUMP", seg, item });
    else arm({ type: "JUMP", seg, item });
  };

  const cur = cursorSegment(state);
  const cursor = state.cursor;
  const talking = running && state.phase === "playing" && cursor?.item === 0;

  // The face, as the home page builds it — the lock screen reads it, and the skin is cut from it.
  const face: PlayerFace | null = (() => {
    if (state.phase === "planning") return { kind: "planning", dj: dj.name };
    if (!cur || !cursor) return null;
    if (cursor.item === 0) {
      return {
        kind: "talk",
        dj: dj.name,
        initial: dj.name.charAt(0).toUpperCase(),
        seq: cur.seq,
        excerpt: firstSentence(cur.talk),
        playback: !running
          ? { paused: true, position: 0, duration: 0, at: 0 }
          : talkPlayback && talkPlayback.duration > 0
            ? talkPlayback
            : null,
      };
    }
    const t = cur.tracks[cursor.item - 1];
    if (!t) return null;
    const p = device.playback;
    const live = p?.uri === t.uri ? p : null;
    return {
      kind: "track",
      name: t.name,
      artists: t.artists,
      album: t.album,
      image: live?.track?.image ?? null,
      playback: live
        ? { paused: live.paused, position: live.position, duration: live.duration, at: live.at }
        : { paused: true, position: 0, duration: t.durationMs, at: 0 },
    };
  })();
  const canPrev = cursor !== null && !(cursor.seg === 0 && cursor.item === 0);
  const canNext = cursor !== null && state.phase === "playing";
  useMediaSession({ face, running, canPrev, canNext, onToggle: toggle, onPrev: prev, onNext: next });

  // What the main window shows.
  const clock: MainClock | null = running && face && face.kind !== "planning" ? face.playback : null;
  const indicator = !running ? "stopped" : clock ? (clock.paused ? "paused" : "playing") : "playing";
  const marquee = (() => {
    if (!running) {
      if (arming) return "activating this tab as the player...";
      return state.segments.length > 0 ? "claude radio - stopped" : "claude radio - off air";
    }
    if (!face || face.kind === "planning") return `${dj.name} is picking the tracks...`;
    if (face.kind === "talk") return `${face.seq}. ${face.dj} on the mic - ${face.excerpt}`;
    const n = cursor ? cursor.item : 0;
    return `${n}. ${face.artists.join(", ")} - ${face.name} (${fmt(face.playback.duration)})`;
  })();

  const play = () => {
    if (!running) {
      goOnAir();
      return;
    }
    if (clock?.paused) toggle();
    else if (cursor) dispatch({ type: "JUMP", ...cursor }); // Winamp's Play restarts the track
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
        segments={state.segments}
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
            {running && prompt.trim() !== (cur?.prompt ?? prompt.trim()) && (
              <div className="wa-dim">the new request reaches the DJ on the next block</div>
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
            {fresh && !stationId && stations.length > 0 && (
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
                      {when(s.updatedAt)} · {s.segmentCount} block{s.segmentCount === 1 ? "" : "s"} ·{" "}
                      {s.prompt}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {!running && stationId && cursor === null && state.segments.length > 0 && (
              <div className="wa-dim">
                resuming ({state.segments.length} block{state.segments.length === 1 ? "" : "s"}) — tap a line,
                or press play.{" "}
                <button
                  type="button"
                  className="wa-link"
                  onClick={() => {
                    setStationId(null);
                    dispatch({ type: "CLEAR_SHOW" });
                  }}
                >
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
