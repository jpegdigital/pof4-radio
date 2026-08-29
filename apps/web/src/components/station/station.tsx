"use client";

import { LogOut, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { guarded, keepGuardAlive } from "@/lib/guard-client";
import { DjPicker } from "./dj-picker";
import { Player, type PlayerFace } from "./player";
import { cursorSegment, type SegmentView } from "./reducer";
import { ResumePicker } from "./resume-picker";
import { Show } from "./show";
import type { SpotifyAccount } from "./spotify-account";
import { Card, focusRing, Label, SpotifyMark } from "./ui";
import { useSpotifyDevice } from "./use-spotify-device";
import { useStation } from "./use-station";
import { DEFAULT_DJ, type Dj, loadDj, saveDj } from "./voice-store";

/**
 * The station, on one page: on air (the lamp and the one button, the DJ, the account), the
 * request, the player, the show. The browser is the whole state machine — nothing happens
 * when this component isn't running.
 */
export function Station({
  clientId,
  account,
  onConnect,
  onDisconnect,
}: {
  clientId: string;
  account: SpotifyAccount | null;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const enabled = account?.product === "premium";
  const [prompt, setPrompt] = useState("");
  const [dj, setDj] = useState<Dj>(DEFAULT_DJ);
  const [stationId, setStationId] = useState<string | null>(null);
  const promptRef = useRef(prompt);
  useEffect(() => {
    promptRef.current = prompt;
  }, [prompt]);

  const dispatchRef = useRef<
    (e: { type: "ENDED" } | { type: "TRACK_CHANGED"; uri: string } | { type: "HALT"; error: string }) => void
  >(() => {});
  const device = useSpotifyDevice(clientId, {
    onTrackListEnded: () => dispatchRef.current({ type: "ENDED" }),
    onTrackChanged: (uri) => dispatchRef.current({ type: "TRACK_CHANGED", uri }),
    onLost: (error) => dispatchRef.current({ type: "HALT", error }),
  });

  const { state, dispatch, talk, talkPlayback, toggle, prev, next, unlock } = useStation({
    device,
    stationId,
    dj,
    getPrompt: () => promptRef.current,
    onStation: setStationId,
  });
  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  // The DJ is remembered per browser. The station is not: a page load is a fresh show —
  // Stop/Run inside the page keeps the DJ's memory, a reload starts over.
  useEffect(() => {
    const stored = loadDj();
    queueMicrotask(() => setDj(stored)); // after hydration, not during it
  }, []);

  // Resume a past show: its prompt and blocks load into the show; tap any block, or Run at the tail.
  const resume = async (id: string) => {
    const res = await guarded(`/api/station/${id}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { stationId: string; prompt: string; segments: SegmentView[] };
    setStationId(data.stationId);
    setPrompt(data.prompt);
    dispatch({ type: "LOAD_SHOW", segments: [...data.segments].sort((a, b) => a.seq - b.seq) });
  };

  // The Guard cookie lasts 15 minutes; a show lasts hours. Keep it fresh without reloading.
  useEffect(keepGuardAlive, []);

  const changeDj = (d: Dj) => {
    setDj(d);
    saveDj(d);
  };

  const ready = device.status.kind === "ready";
  const running = state.loop === "running";
  const fresh = !running && state.segments.length === 0;
  const requestBox = useRef<HTMLTextAreaElement>(null);
  const [needRequest, setNeedRequest] = useState(false);

  // "Go on air" is one tap even when this tab isn't the Spotify device yet: it registers the tab
  // and runs the moment the device is ready. The unlock/activate calls must stay inside the tap.
  // "Connecting" only ever happens from this tap now, so the button can read it straight off the device.
  const arming = device.status.kind === "connecting";
  const armed = useRef(false);
  const goOnAir = () => {
    if (prompt.trim() === "") {
      // Not a disabled button: the tap says what's missing and puts the cursor there.
      setNeedRequest(true);
      requestBox.current?.focus();
      return;
    }
    unlock();
    device.activate();
    if (ready) {
      dispatch({ type: "RUN" });
      return;
    }
    armed.current = true;
    void device.connect();
  };
  useEffect(() => {
    if (!armed.current) return;
    if (ready) {
      armed.current = false;
      dispatch({ type: "RUN" });
    } else if (device.status.kind === "error") {
      armed.current = false;
    }
  }, [ready, device.status.kind, dispatch]);
  const cur = cursorSegment(state);
  const cursor = state.cursor;
  const talking = running && state.phase === "playing" && cursor?.item === 0;

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

  const status = (() => {
    if (!running) return state.segments.length > 0 ? "Stopped" : "Off air";
    if (state.phase === "planning") return "The DJ is planning…";
    if (talking) return `${dj.name} on the mic`;
    if (cur && cursor) return `Track ${cursor.item} of ${cur.tracks.length}`;
    return "On air";
  })();

  const canPrev = cursor !== null && !(cursor.seg === 0 && cursor.item === 0);
  const canNext = cursor !== null && state.phase === "playing";

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
          {account ? (
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <SpotifyMark className="size-4 shrink-0 text-[#1DB954]" />
              <span className="truncate text-zinc-300">{account.displayName ?? account.spotifyUserId}</span>
              {!enabled && <span className="shrink-0 text-xs text-amber-300/90">not Premium</span>}
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
          placeholder="What do you want to hear tonight? e.g. late-night soul with horns"
          maxLength={500}
          rows={3}
          aria-label="The request"
          className={`w-full resize-none rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-3 font-mono text-base leading-relaxed placeholder:text-zinc-600 ${focusRing}`}
        />
        {needRequest && prompt.trim() === "" && (
          <p className="-mt-2 text-xs text-lamp">Tell the DJ what you want to hear first.</p>
        )}
        {running && prompt.trim() !== (cur?.prompt ?? prompt.trim()) && (
          <p className="-mt-2 text-xs text-zinc-500">The new request reaches the DJ on the next block.</p>
        )}
        {!account && <p className="-mt-2 text-xs text-zinc-500">Playback needs a Spotify Premium account.</p>}
        {device.status.kind === "error" && (
          <p className="-mt-2 text-xs text-red-400">
            This tab couldn&rsquo;t become the player: {device.status.message}
          </p>
        )}
        {fresh && enabled && !stationId && <ResumePicker onPick={(id) => void resume(id)} />}
        {!running && stationId && cursor === null && state.segments.length > 0 && (
          <p className="text-xs text-zinc-500">
            Resuming ({state.segments.length} block{state.segments.length === 1 ? "" : "s"}) — tap a block, or
            go on air.{" "}
            <button
              type="button"
              onClick={() => {
                setStationId(null);
                dispatch({ type: "CLEAR_SHOW" });
              }}
              className="underline underline-offset-2 hover:text-zinc-300"
            >
              Start fresh
            </button>
          </p>
        )}

        <div className="flex items-start gap-3 pb-1.5">
          {/* the voice field, its name on a plate riding the bottom-left of the bezel — the way a
              console labels a control: on it, not near it. Lit while the DJ is actually talking. */}
          <div className="relative min-w-0 flex-1">
            <DjPicker value={dj} onChange={changeDj} />
            <span
              aria-hidden="true"
              className={`absolute -bottom-2 left-3 rounded-[3px] px-1.5 py-px font-display text-[10px] font-semibold uppercase tracking-[0.22em] transition ${
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

      {/* the player: mounted from the first block on, never unmounts */}
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

      {/* the show */}
      <Show
        segments={state.segments}
        cursor={cursor}
        voiced={(id) => {
          const t = talk(id);
          return t !== undefined && "url" in t;
        }}
        onJump={(seg, item) => {
          if (!ready) return;
          unlock();
          device.activate();
          dispatch({ type: "JUMP", seg, item });
        }}
      />
    </>
  );
}

function firstSentence(text: string): string {
  const m = text.match(/^.*?[.!?…](\s|$)/);
  return (m ? m[0] : text).trim();
}
