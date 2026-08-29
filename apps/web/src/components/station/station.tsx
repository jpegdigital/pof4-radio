"use client";

import { Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { guarded, keepGuardAlive } from "@/lib/guard-client";
import { Desk } from "./desk";
import { Masthead } from "./masthead";
import { Player, type PlayerFace } from "./player";
import { cursorSegment, type SegmentView } from "./reducer";
import { ResumePicker } from "./resume-picker";
import { Show } from "./show";
import type { SpotifyAccount } from "./spotify-account";
import { Card, focusRing, Label } from "./ui";
import { useSpotifyDevice } from "./use-spotify-device";
import { useStation } from "./use-station";
import { DEFAULT_DJ, type Dj, loadDj, saveDj } from "./voice-store";

/**
 * The station, on one page: the masthead (with the on-air lamp), the desk (account, player, DJ),
 * the request, the player, the show. The browser is the whole state machine — nothing happens
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
  const canRun = enabled && ready && prompt.trim() !== "";
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
      <Masthead running={running} talking={talking} />

      {/* the desk: what to set before going on air, in the order it gates */}
      <Desk
        account={account}
        onConnect={onConnect}
        onDisconnect={onDisconnect}
        device={device.status}
        onActivate={() => {
          device.activate();
          void device.connect();
        }}
        dj={dj}
        onDj={changeDj}
      />

      {/* the request */}
      <Card className="flex flex-col gap-3">
        <Label>The request</Label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="What do you want to hear tonight? e.g. late-night soul with horns"
          maxLength={500}
          rows={3}
          className={`w-full resize-none rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 font-mono text-sm leading-relaxed placeholder:text-zinc-600 ${focusRing}`}
        />
        {running && prompt.trim() !== (cur?.prompt ?? prompt.trim()) && (
          <p className="-mt-1 text-xs text-zinc-500">The new request reaches the DJ on the next block.</p>
        )}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            {fresh && enabled && !stationId && <ResumePicker onPick={(id) => void resume(id)} />}
            {!running && stationId && cursor === null && state.segments.length > 0 && (
              <p className="text-xs text-zinc-500">
                Resuming ({state.segments.length} block{state.segments.length === 1 ? "" : "s"}) — tap a
                block, or go on air.{" "}
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
          </div>
          {running ? (
            <button
              type="button"
              onClick={() => dispatch({ type: "STOP" })}
              className={`flex items-center gap-2 rounded-full bg-zinc-100 px-5 py-2 text-sm font-semibold text-black ${focusRing}`}
            >
              <Square className="size-3.5" fill="currentColor" strokeWidth={0} aria-hidden="true" />
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                unlock();
                device.activate();
                dispatch({ type: "RUN" });
              }}
              disabled={!canRun}
              className={`rounded-full bg-lamp px-5 py-2 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100 ${focusRing}`}
            >
              Go on air
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
