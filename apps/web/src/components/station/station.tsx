"use client";

import { Radio, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { guarded, keepGuardAlive } from "@/lib/guard-client";
import { DjPicker } from "./dj-picker";
import { NowPlaying } from "./now-playing";
import type { SegmentView } from "./reducer";
import { ResumePicker } from "./resume-picker";
import { Card, focusRing, Label } from "./ui";
import { useSpotifyDevice } from "./use-spotify-device";
import { useStation } from "./use-station";
import { DEFAULT_DJ, type Dj, loadDj, saveDj } from "./voice-store";

/**
 * The station, on one page: on air (the lamp, the DJ, the player), the request, the transport,
 * what's queued and what already aired. The browser is the whole state machine — nothing
 * happens when this component isn't running.
 */
export function Station({ enabled, clientId }: { enabled: boolean; clientId: string }) {
  const [prompt, setPrompt] = useState("");
  const [dj, setDj] = useState<Dj>(DEFAULT_DJ);
  const [stationId, setStationId] = useState<string | null>(null);
  const [history, setHistory] = useState<SegmentView[]>([]);
  const promptRef = useRef(prompt);
  const djRef = useRef(dj);
  useEffect(() => {
    promptRef.current = prompt;
    djRef.current = dj;
  }, [prompt, dj]);

  const dispatchRef = useRef<
    (
      e:
        | { type: "TRACK_LIST_ENDED" }
        | { type: "TRACK_CHANGED"; uri: string }
        | { type: "HALT"; error: string },
    ) => void
  >(() => {});
  const device = useSpotifyDevice(clientId, {
    onTrackListEnded: () => dispatchRef.current({ type: "TRACK_LIST_ENDED" }),
    onTrackChanged: (uri) => dispatchRef.current({ type: "TRACK_CHANGED", uri }),
    onLost: (error) => dispatchRef.current({ type: "HALT", error }),
  });

  const { state, dispatch, unlock } = useStation({
    device,
    stationId,
    getPrompt: () => promptRef.current,
    getVoice: () => djRef.current.voice,
    getDj: () => djRef.current.name,
    onStation: setStationId,
    onSegment: (seg) => setHistory((h) => [seg, ...h].slice(0, 20)),
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

  // Resume a past show: load its prompt and history; Run then continues that conversation.
  const resume = async (id: string) => {
    const res = await guarded(`/api/station/${id}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { stationId: string; prompt: string; segments: SegmentView[] };
    setStationId(data.stationId);
    setPrompt(data.prompt);
    setHistory(data.segments);
  };
  const fresh = state.loop === "stopped" && !state.current && !state.next;

  // The Guard cookie lasts 15 minutes; a show lasts hours. Keep it fresh without reloading.
  useEffect(keepGuardAlive, []);

  const changeDj = (d: Dj) => {
    setDj(d);
    saveDj(d);
  };

  const ready = device.status.kind === "ready";
  const running = state.loop === "running";
  const canRun = enabled && ready && prompt.trim() !== "";
  const cur = state.current;
  const songPaused = device.playback?.paused ?? false;
  const past = history.filter((s) => s.id !== cur?.segment.id && s.id !== state.next?.segment.id);

  const status = (() => {
    if (!running) return state.current || state.next ? "Stopped" : "Off air";
    switch (state.phase) {
      case "planning":
        return "The DJ is planning…";
      case "talk":
        return cur?.talkUrl ? `${dj.name} on the mic` : `${dj.name} on the mic (loading voice…)`;
      case "tracks":
        return `Track ${state.trackIndex + 1} of ${cur?.segment.tracks.length ?? 0}`;
      default:
        return "On air";
    }
  })();
  const talking = running && state.phase === "talk";

  return (
    <>
      {/* on air: the lamp, the DJ, the player */}
      <Card className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className={`lamp size-2.5 rounded-full ${running ? "on" : ""} ${talking ? "talking" : ""}`}
            />
            <Label className={running ? "text-lamp" : ""}>On air</Label>
          </div>
          <DjPicker value={dj} onChange={changeDj} />
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          {ready ? (
            <span className="flex items-center gap-2 text-zinc-400">
              <Radio className="size-4 text-[#1DB954]" strokeWidth={1.75} aria-hidden="true" />
              This tab is the player
            </span>
          ) : (
            <button
              type="button"
              onClick={() => {
                device.activate();
                void device.connect();
              }}
              disabled={!enabled || device.status.kind === "connecting"}
              className={`flex items-center gap-2 rounded-full border border-zinc-700 px-4 py-2 font-medium text-zinc-100 transition hover:border-zinc-500 disabled:opacity-40 ${focusRing}`}
            >
              <Radio className="size-4" strokeWidth={1.75} aria-hidden="true" />
              {device.status.kind === "connecting" ? "Activating…" : "Activate this tab as the player"}
            </button>
          )}
          {device.status.kind === "error" && <span className="text-red-400">{device.status.message}</span>}
          {!enabled && <span className="text-xs text-zinc-500">Connect a Premium account first.</span>}
        </div>
      </Card>

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
        {running && prompt.trim() !== (cur?.segment.prompt ?? prompt.trim()) && (
          <p className="-mt-1 text-xs text-zinc-500">The new request reaches the DJ on the next block.</p>
        )}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            {fresh && enabled && !stationId && <ResumePicker onPick={(id) => void resume(id)} />}
            {fresh && stationId && (
              <p className="text-xs text-zinc-500">
                Resuming ({history.length} block{history.length === 1 ? "" : "s"}).{" "}
                <button
                  type="button"
                  onClick={() => {
                    setStationId(null);
                    setHistory([]);
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

      {/* now playing: the transport, once anything is on air */}
      {(cur || state.next || running) && (
        <Card className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <Label>Now playing</Label>
            <span className={`text-xs ${running ? "text-zinc-300" : "text-zinc-500"}`}>{status}</span>
            {running && state.phase === "talk" && (
              <button
                type="button"
                onClick={() => dispatch({ type: "SKIP_TALK" })}
                className={`text-xs text-zinc-400 underline-offset-2 hover:underline ${focusRing}`}
              >
                Skip talk
              </button>
            )}
          </div>

          {talking && cur ? (
            <p className="font-mono text-sm leading-relaxed text-zinc-300">{cur.segment.talk}</p>
          ) : device.playback?.track ? (
            <NowPlaying
              playback={device.playback}
              onPrev={() => dispatch({ type: "PREV" })}
              onNext={() => dispatch({ type: "NEXT" })}
              onToggle={() => void (songPaused ? device.resume() : device.pause())}
            />
          ) : (
            <p className="text-sm text-zinc-500">{running ? "Waiting for the DJ…" : "Nothing playing."}</p>
          )}

          {cur && state.phase === "tracks" && (
            <TrackList tracks={cur.segment.tracks} activeIndex={state.trackIndex} />
          )}
          {state.next && <p className="text-xs text-zinc-500">Next block ready.</p>}
        </Card>
      )}

      {/* next up */}
      {state.next && (
        <Card>
          <Label className="mb-3">Next up</Label>
          <SegmentBody segment={state.next.segment} />
        </Card>
      )}

      {/* history: what already aired, newest first — not what's on air or buffered */}
      {past.length > 0 && (
        <div className="flex flex-col gap-3">
          <Label>Earlier tonight</Label>
          {past.map((s) => (
            <Card key={s.id} className="bg-transparent">
              <SegmentBody segment={s} />
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function SegmentBody({ segment }: { segment: SegmentView }) {
  return (
    <>
      <div className="mb-2 truncate text-xs text-zinc-500">
        #{segment.seq} · “{segment.prompt}”
      </div>
      <p className="mb-3 font-mono text-sm leading-relaxed text-zinc-400">{segment.talk}</p>
      <TrackList tracks={segment.tracks} activeIndex={-1} />
    </>
  );
}

function TrackList({ tracks, activeIndex }: { tracks: SegmentView["tracks"]; activeIndex: number }) {
  return (
    <ol className="flex flex-col gap-1 text-sm">
      {tracks.map((t, i) => (
        <li
          key={t.id}
          className={`flex items-baseline gap-2 ${i === activeIndex ? "text-lamp" : "text-zinc-400"}`}
        >
          <span className="w-4 shrink-0 font-mono text-xs text-zinc-600">{i + 1}</span>
          <span className="min-w-0 flex-1 truncate">
            {t.artists.join(", ")} — {t.name}
          </span>
          <span className="font-mono text-xs tabular-nums text-zinc-600">{clock(t.durationMs)}</span>
        </li>
      ))}
    </ol>
  );
}

function clock(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
