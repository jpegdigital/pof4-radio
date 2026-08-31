"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DEFAULTS } from "../api/sessions/params";

/**
 * The home: a prompt and the knobs. The form posts only what was touched — an empty knob means
 * the server's default (params.ts is the single source of truth; the placeholders just show it).
 * Success is a soft redirect to /sessions/:id, where the session renders and grows; this page
 * only creates.
 */

const KNOBS = ["propose", "candidates", "playlist", "min"] as const;

type State = { phase: "idle" } | { phase: "working" } | { phase: "error"; message: string };

export default function HomePage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [voiceId, setVoiceId] = useState("default");
  const [knobs, setKnobs] = useState<{ [k in (typeof KNOBS)[number]]: string }>({
    propose: "",
    candidates: "",
    playlist: "",
    min: "",
  });
  const [state, setState] = useState<State>({ phase: "idle" });

  async function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    setState({ phase: "working" });
    const body: Record<string, unknown> = { prompt, voiceId };
    for (const k of KNOBS) if (knobs[k].trim() !== "") body[k] = Number(knobs[k]);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as { sessionId?: string; error?: string } | null;
      if (!res.ok || !data?.sessionId) {
        setState({ phase: "error", message: data?.error ?? `HTTP ${res.status}` });
        return;
      }
      router.push(`/sessions/${data.sessionId}`);
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

      {state.phase === "error" && (
        <p className="rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
          {state.message}
        </p>
      )}
    </div>
  );
}
