"use client";

import { useEffect, useRef, useState } from "react";
import type { SegmentView } from "./reducer";
import { useSpotifyDevice } from "./use-spotify-device";
import { useStation } from "./use-station";
import { VoiceSettingsPanel } from "./voice-settings";
import { DEFAULT_VOICE, loadVoice, saveVoice, type VoiceSettings } from "./voice-store";

/**
 * The station, on one page: the Spotify device, the prompt, Run/Stop, transport, what's on
 * air, the voice settings and the history. The browser is the whole state machine — nothing
 * happens when this component isn't running.
 */
export function Station({ enabled }: { enabled: boolean }) {
  const [prompt, setPrompt] = useState("");
  const [voice, setVoice] = useState<VoiceSettings>(DEFAULT_VOICE);
  const [stationId, setStationId] = useState<string | null>(null);
  const [history, setHistory] = useState<SegmentView[]>([]);
  const [showVoice, setShowVoice] = useState(false);
  const promptRef = useRef(prompt);
  const voiceRef = useRef(voice);
  useEffect(() => {
    promptRef.current = prompt;
    voiceRef.current = voice;
  }, [prompt, voice]);

  const dispatchRef = useRef<
    (
      e:
        | { type: "TRACK_LIST_ENDED" }
        | { type: "TRACK_CHANGED"; uri: string }
        | { type: "HALT"; error: string },
    ) => void
  >(() => {});
  const device = useSpotifyDevice({
    onTrackListEnded: () => dispatchRef.current({ type: "TRACK_LIST_ENDED" }),
    onTrackChanged: (uri) => dispatchRef.current({ type: "TRACK_CHANGED", uri }),
    onLost: (error) => dispatchRef.current({ type: "HALT", error }),
  });

  const { state, dispatch } = useStation({
    device,
    stationId,
    getPrompt: () => promptRef.current,
    getVoice: () => voiceRef.current,
    onStation: setStationId,
    onSegment: (seg) => setHistory((h) => [seg, ...h].slice(0, 20)),
  });
  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  // The voice is remembered per browser. The station is not: a page load is a fresh show —
  // Stop/Run inside the page keeps the DJ's memory, a reload starts over.
  useEffect(() => {
    const stored = loadVoice();
    queueMicrotask(() => setVoice(stored)); // after hydration, not during it
  }, []);

  const changeVoice = (v: VoiceSettings) => {
    setVoice(v);
    saveVoice(v);
  };

  const ready = device.status.kind === "ready";
  const canRun = enabled && ready && voice.voiceId !== "" && prompt.trim() !== "";
  const cur = state.current;
  const track = cur && state.phase === "tracks" ? cur.segment.tracks[state.trackIndex] : undefined;
  const songPaused = device.playback?.paused ?? false;
  const past = history.filter((s) => s.id !== cur?.segment.id && s.id !== state.next?.segment.id);

  const status = (() => {
    if (state.loop === "stopped") return state.current || state.next ? "Stopped" : "Idle";
    switch (state.phase) {
      case "planning":
        return "The DJ is planning…";
      case "talk":
        return cur?.talkUrl ? "DJ talking" : "DJ talking (loading voice…)";
      case "tracks":
        return `Playing ${state.trackIndex + 1} of ${cur?.segment.tracks.length ?? 0}`;
      default:
        return "Running";
    }
  })();

  return (
    <div className="flex flex-col gap-4">
      {/* device */}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {ready ? (
          <span className="text-green-400">Player ready</span>
        ) : (
          <button
            type="button"
            onClick={() => void device.connect()}
            disabled={!enabled || device.status.kind === "connecting"}
            className="rounded-md bg-zinc-100 px-3 py-1.5 font-medium text-black disabled:opacity-40"
          >
            {device.status.kind === "connecting" ? "Connecting…" : "Start player in this tab"}
          </button>
        )}
        {device.status.kind === "error" && <span className="text-red-400">{device.status.message}</span>}
        {!enabled && <span className="text-zinc-500">connect a Premium account first</span>}
        <button
          type="button"
          onClick={() => setShowVoice((v) => !v)}
          className="ml-auto text-zinc-400 underline-offset-2 hover:underline"
        >
          Voice settings{voice.voiceId ? "" : " (choose a voice)"}
        </button>
      </div>

      {showVoice && (
        <div className="rounded-lg border border-zinc-800 p-3">
          <VoiceSettingsPanel value={voice} onChange={changeVoice} />
        </div>
      )}

      {/* prompt + loop */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="What do you want to hear? e.g. late-night soul with horns"
          maxLength={500}
          className="flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
        />
        {state.loop === "running" ? (
          <button
            type="button"
            onClick={() => dispatch({ type: "STOP" })}
            className="rounded-md bg-red-500 px-4 py-2 text-sm font-medium text-black"
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={() => dispatch({ type: "RUN" })}
            disabled={!canRun}
            className="rounded-md bg-green-500 px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
          >
            Run
          </button>
        )}
      </div>
      {state.loop === "running" && prompt.trim() !== (cur?.segment.prompt ?? prompt.trim()) && (
        <p className="-mt-2 text-xs text-zinc-500">New prompt applies to the next block.</p>
      )}

      {/* status + transport */}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className={state.loop === "running" ? "text-zinc-200" : "text-zinc-500"}>{status}</span>
        {state.loop === "running" && state.phase === "talk" && (
          <button type="button" onClick={() => dispatch({ type: "SKIP_TALK" })} className={btn}>
            Skip talk ⏭
          </button>
        )}
        {state.loop === "running" && state.phase === "tracks" && (
          <>
            <button
              type="button"
              onClick={() => dispatch({ type: "PREV" })}
              className={btn}
              aria-label="previous"
            >
              ⏮
            </button>
            <button
              type="button"
              onClick={() => void (songPaused ? device.resume() : device.pause())}
              className={btn}
              aria-label={songPaused ? "play" : "pause"}
            >
              {songPaused ? "▶" : "⏸"}
            </button>
            <button
              type="button"
              onClick={() => dispatch({ type: "NEXT" })}
              className={btn}
              aria-label="next"
            >
              ⏭
            </button>
            {track && (
              <span className="truncate text-zinc-300">
                {track.artists.join(", ")} — {track.name}
              </span>
            )}
          </>
        )}
        {state.next && <span className="text-xs text-zinc-500">next block ready</span>}
      </div>

      {state.error && (
        <div className="flex items-start justify-between gap-3 rounded-md border border-red-900 bg-red-950/40 p-2 text-sm text-red-300">
          <span>{state.error}</span>
          <button type="button" onClick={() => dispatch({ type: "CLEAR_ERROR" })} className="text-red-400">
            ×
          </button>
        </div>
      )}

      {/* on air */}
      {cur && (
        <SegmentCard
          segment={cur.segment}
          active={state.loop === "running"}
          activeIndex={state.phase === "tracks" ? state.trackIndex : -1}
        />
      )}

      {/* next up */}
      {state.next && (
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Next up</h3>
          <SegmentCard segment={state.next.segment} active={false} activeIndex={-1} />
        </div>
      )}

      {/* history: what already aired, newest first — not what's on air or buffered */}
      {past.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">History</h3>
          <ol className="flex flex-col gap-2">
            {past.map((s) => (
              <SegmentCard key={s.id} segment={s} active={false} activeIndex={-1} />
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

const btn = "rounded-md bg-zinc-800 px-2.5 py-1 text-zinc-100 hover:bg-zinc-700";

function SegmentCard({
  segment,
  active,
  activeIndex,
}: {
  segment: SegmentView;
  active: boolean;
  activeIndex: number;
}) {
  return (
    <li className={`list-none rounded-lg border p-3 ${active ? "border-green-500" : "border-zinc-800"}`}>
      <div className="mb-1 flex items-baseline justify-between gap-3 text-xs text-zinc-500">
        <span className="truncate">
          #{segment.seq} · “{segment.prompt}”
        </span>
      </div>
      <p className="mb-2 text-sm italic text-zinc-300">{segment.talk}</p>
      <ul className="text-sm">
        {segment.tracks.map((t, i) => (
          <li key={t.id} className={`truncate ${i === activeIndex ? "text-green-400" : ""}`}>
            {t.artists.join(", ")} — {t.name}{" "}
            <span className="text-zinc-500">· {Math.round(t.durationMs / 1000)}s</span>
          </li>
        ))}
      </ul>
    </li>
  );
}
