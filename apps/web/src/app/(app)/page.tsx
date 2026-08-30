"use client";

import { useState } from "react";
import { DEFAULTS } from "../api/sessions/params";

/**
 * The new home: a prompt, the knobs, and the playlist it becomes. The form posts only what was
 * touched — an empty knob means the server's default (params.ts is the single source of truth;
 * the placeholders just show it). Read-only result: rationale, the tracks, the dropped receipts.
 */

interface Track {
  id: string;
  uri: string;
  name: string;
  artists: string[];
  album: string;
  image: string | null;
  durationMs: number;
  pick: number;
  why: string;
}

interface Result {
  sessionId: string;
  rationale: string;
  tracks: Track[];
  dropped: string[];
}

const KNOBS = ["propose", "candidates", "playlist", "min"] as const;

type State =
  | { phase: "idle" }
  | { phase: "working" }
  | { phase: "done"; result: Result }
  | { phase: "error"; message: string };

export default function HomePage() {
  const [prompt, setPrompt] = useState("");
  const [voiceId, setVoiceId] = useState("default");
  const [knobs, setKnobs] = useState<{ [k in (typeof KNOBS)[number]]: string }>({
    propose: "",
    candidates: "",
    playlist: "",
    min: "",
  });
  const [state, setState] = useState<State>({ phase: "idle" });
  const [sent, setSent] = useState<string | null>(null);

  async function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    setState({ phase: "working" });
    const body: Record<string, unknown> = { prompt, voiceId };
    for (const k of KNOBS) if (knobs[k].trim() !== "") body[k] = Number(knobs[k]);
    setSent(JSON.stringify(body, null, 2));
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as Result | { error?: string } | null;
      if (!res.ok || !data || !("sessionId" in data)) {
        const message =
          data && "error" in data && typeof data.error === "string" ? data.error : `HTTP ${res.status}`;
        setState({ phase: "error", message });
        return;
      }
      setState({ phase: "done", result: data });
    } catch (err) {
      setState({ phase: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  const working = state.phase === "working";

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
      <h1 className="font-display text-2xl font-semibold uppercase tracking-[0.18em]">Claude Radio</h1>

      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="What should the hour sound like?"
          rows={3}
          required
          className="w-full resize-none rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-2 focus:outline-zinc-500"
        />
        <div className="grid grid-cols-5 gap-2">
          {KNOBS.map((k) => (
            <label key={k} className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-zinc-500">
              {k}
              <input
                type="number"
                value={knobs[k]}
                onChange={(e) => setKnobs({ ...knobs, [k]: e.target.value })}
                placeholder={String(DEFAULTS[k])}
                className="rounded-md border border-zinc-800 bg-zinc-950 p-2 text-center text-sm text-zinc-200 placeholder:text-zinc-600"
              />
            </label>
          ))}
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-zinc-500">
            voice
            <input
              value={voiceId}
              onChange={(e) => setVoiceId(e.target.value)}
              className="rounded-md border border-zinc-800 bg-zinc-950 p-2 text-center text-sm text-zinc-200"
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={working}
          className="rounded-lg bg-zinc-200 py-2.5 text-sm font-semibold text-zinc-900 transition hover:bg-white disabled:opacity-50"
        >
          {working ? "Composing…" : "Make a playlist"}
        </button>
      </form>

      {sent && (
        <details className="text-xs text-zinc-600">
          <summary className="cursor-pointer">request body</summary>
          <pre className="mt-2 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3">{sent}</pre>
        </details>
      )}

      {state.phase === "error" && (
        <p className="rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
          {state.message}
        </p>
      )}

      {state.phase === "done" && (
        <div className="flex flex-col gap-4">
          <p className="text-sm leading-relaxed text-zinc-400">{state.result.rationale}</p>
          <ol className="flex flex-col gap-2">
            {state.result.tracks.map((t, i) => (
              <li
                key={t.id}
                className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-2"
              >
                <span className="w-5 text-right text-xs text-zinc-600">{i + 1}</span>
                {t.image && <img src={t.image} alt="" className="size-10 rounded" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-zinc-200">{t.name}</span>
                  <span className="block truncate text-xs text-zinc-500">
                    {t.artists.join(", ")} · {t.album}
                  </span>
                </span>
                <span className="text-xs tabular-nums text-zinc-600">
                  {Math.floor(t.durationMs / 60000)}:
                  {String(Math.floor((t.durationMs % 60000) / 1000)).padStart(2, "0")}
                </span>
              </li>
            ))}
          </ol>
          {state.result.dropped.length > 0 && (
            <details className="text-xs text-zinc-600">
              <summary className="cursor-pointer">{state.result.dropped.length} dropped</summary>
              <ul className="mt-2 flex flex-col gap-1">
                {state.result.dropped.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
