"use client";

import { useEffect, useState } from "react";
import type { Manifest } from "../manifest";

/**
 * The clock, on paper: ask Claude to plan the whole program over the manifest's songs (call 1),
 * then write every word for it (call 2), and print the rundown as text — how the hour would
 * flow, before any of it is wired to audio.
 */
type Intro = "talkup" | "sweeper" | "segue" | "break";
interface Result {
  plan: {
    slots: { song: number; intro: Intro; introMs: number; sure: boolean; post: string; why: string }[];
  };
  words: { slots: { song: number; words: string; legalId?: string }[] };
  timing: { planMs: number; wordsMs: number };
  usage: { plan: { output_tokens: number }; words: { output_tokens: number } };
}

const MARK: Record<Intro, string> = { talkup: "talk-up", sweeper: "sweeper", segue: "segue", break: "break" };
const TONE: Record<Intro, string> = {
  talkup: "text-amber-300",
  sweeper: "text-sky-300",
  segue: "text-zinc-500",
  break: "text-lamp",
};

export default function Clock() {
  const [m, setM] = useState<Manifest | null>(null);
  const [mode, setMode] = useState<"open" | "join" | "top">("open");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [r, setR] = useState<Result | null>(null);

  useEffect(() => {
    void fetch("/program/manifest.json")
      .then((res) => res.json())
      .then(setM);
  }, []);

  const run = async () => {
    if (!m) return;
    setBusy(true);
    setError(null);
    setR(null);
    const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const res = await fetch("/api/program/clock", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode,
        station: m.station,
        dj: m.dj,
        time,
        songs: m.songs.map((s) => ({ name: s.name, artists: s.artists, durationMs: s.durationMs })),
      }),
    });
    const j = (await res.json()) as Result & { error?: string };
    if (res.ok) setR(j);
    else setError(j.error ?? res.statusText);
    setBusy(false);
  };

  const wordsFor = (song: number) => {
    const w = r?.words.slots.find((x) => x.song === song);
    return w ? [w.legalId, w.words].filter(Boolean).join("\n\n") : "";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as "open" | "join" | "top")}
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
        >
          <option value="open">cold open</option>
          <option value="join">join mid-hour</option>
          <option value="top">top of the hour</option>
        </select>
        <button
          type="button"
          onClick={() => void run()}
          disabled={!m || busy}
          className="rounded-lg bg-lamp px-4 py-2 font-medium text-black disabled:opacity-50"
        >
          {busy ? "planning…" : "Plan the clock"}
        </button>
        {r && (
          <span className="font-mono text-xs text-zinc-500">
            plan {(r.timing.planMs / 1000).toFixed(1)} s · words {(r.timing.wordsMs / 1000).toFixed(1)} s ·
            out {r.usage.plan.output_tokens + r.usage.words.output_tokens} tok
          </span>
        )}
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}

      {r && m && (
        <ol className="space-y-5">
          {r.plan.slots.map((p) => {
            const s = m.songs[p.song];
            const words = wordsFor(p.song);
            return (
              <li key={p.song} className="space-y-2">
                <div className="rounded-xl border border-zinc-800 p-4">
                  <div className="flex flex-wrap items-baseline gap-3">
                    <span className={`font-mono text-xs uppercase tracking-widest ${TONE[p.intro]}`}>
                      {MARK[p.intro]}
                    </span>
                    {p.intro === "talkup" && (
                      <span className="font-mono text-xs text-zinc-500">
                        {(p.introMs / 1000).toFixed(0)} s intro{p.sure ? "" : " (unsure)"} · post “{p.post}”
                      </span>
                    )}
                    <span className="text-xs text-zinc-600">{p.why}</span>
                  </div>
                  {words && <p className="mt-2 whitespace-pre-line leading-relaxed">{words}</p>}
                </div>
                <div className="flex items-baseline gap-3 pl-4 text-zinc-400">
                  <span className="text-lg">♪</span>
                  <span className="font-medium text-zinc-200">{s?.artists.join(", ")}</span>
                  <span>{s?.name}</span>
                  <span className="font-mono text-xs text-zinc-600">
                    {Math.round((s?.durationMs ?? 0) / 1000)} s
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
