"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { DjPicker } from "@/components/station/dj-picker";
import { Card, focusRing, Label } from "@/components/station/ui";
import { type Dj, findDj, loadDj, saveDj } from "@/components/station/voice-store";

/**
 * The front desk: the ask and who's on the mic, then the log — every session so far, newest
 * first, each a row on the rail to pick up where it stands. The roster and the log arrive with
 * the page (page.tsx); the DJ picked last time is remembered per browser (voice-store). POST
 * /api/sessions is creation only and instant — success is a soft redirect to /sessions/:id,
 * where the state machine lives and production starts.
 */

export interface SessionSummary {
  sessionId: string;
  prompt: string;
  /** The DJ's name — the roster's, or the roster's first when the session's voice is gone from it. */
  dj: string;
  /** Segments with a playlist. */
  segments: number;
  createdAt: string;
}

type State = { phase: "idle" } | { phase: "working" } | { phase: "error"; message: string };

const noSubscribe = () => () => {};

export function HomeDesk({ djs, sessions }: { djs: Dj[]; sessions: SessionSummary[] }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  // The remembered DJ, read so the server and the first client render agree (the roster's first), then this browser's.
  const remembered = useSyncExternalStore(
    noSubscribe,
    () => loadDj(djs),
    () => findDj(djs, ""),
  );
  const [picked, setPicked] = useState<Dj | null>(null);
  const dj = picked ?? remembered;
  const [state, setState] = useState<State>({ phase: "idle" });

  async function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    setState({ phase: "working" });
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, voiceId: dj.id }),
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
  const canStart = prompt.trim().length > 0 && dj.id !== "" && !working;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pt-5 pb-10">
      <h1 className="font-display text-2xl font-semibold uppercase tracking-[0.18em]">Claude Radio</h1>

      <Card className="flex flex-col gap-4">
        <Label>The ask</Label>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What should the hour sound like?"
            rows={3}
            required
            maxLength={500}
            className={`w-full resize-none rounded-xl border border-zinc-800 bg-zinc-950 p-3 font-mono text-sm leading-relaxed text-zinc-200 transition placeholder:text-zinc-600 hover:border-zinc-700 ${focusRing}`}
          />
          <div className="flex items-center gap-2">
            <DjPicker
              djs={djs}
              value={dj}
              onChange={(d) => {
                setPicked(d);
                saveDj(d);
              }}
            />
            <button
              type="submit"
              disabled={!canStart}
              className={`flex shrink-0 items-center gap-1.5 rounded-xl bg-lamp px-4 py-2.5 text-sm font-semibold text-zinc-950 transition hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100 ${focusRing}`}
            >
              {working ? "Opening…" : "On air"}
              {!working && <ArrowRight className="size-4" strokeWidth={2} aria-hidden="true" />}
            </button>
          </div>
        </form>
        {djs.length === 0 && (
          <p className="text-xs text-amber-300/90">No voices on the roster yet — add one on /settings.</p>
        )}
        {state.phase === "error" && (
          <p className="rounded-xl border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
            {state.message}
          </p>
        )}
      </Card>

      {sessions.length > 0 && (
        <div className="flex flex-col gap-3">
          <Label>Earlier</Label>
          <ol className="flex flex-col">
            {sessions.map((s) => (
              <li key={s.sessionId} className="rail-row">
                <Link
                  href={`/sessions/${s.sessionId}`}
                  className={`flex flex-col gap-1 rounded-r-lg py-2.5 pr-3 pl-4 transition hover:bg-zinc-800/50 ${focusRing}`}
                >
                  <span className="flex items-baseline justify-between gap-3 font-display text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                    <time dateTime={s.createdAt} suppressHydrationWarning>
                      {when(s.createdAt)}
                    </time>
                    <span className="min-w-0 truncate">
                      {s.dj} ·{" "}
                      {s.segments === 0
                        ? "nothing yet"
                        : `${s.segments} segment${s.segments === 1 ? "" : "s"}`}
                    </span>
                  </span>
                  <span className="line-clamp-2 font-mono text-sm leading-relaxed text-zinc-300">
                    {s.prompt}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
