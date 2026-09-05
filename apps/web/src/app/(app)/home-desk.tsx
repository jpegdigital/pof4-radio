"use client";

import { ArrowRight, Radio, Settings2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { DjPicker } from "./lib/dj-picker";
import { Card, focusRing, Label } from "./lib/ui";
import { type Dj, findDj, loadDj, saveDj } from "./lib/voice-store";

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
  /** Slots on the rundown, proposed or played. */
  slots: number;
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
    <main className="station-shell">
      <header className="station-header">
        <span className="station-wordmark">
          <Radio className="size-5 text-lamp" aria-hidden="true" /> Claude Radio
        </span>
        <Link
          href="/settings"
          className={`flex min-h-11 items-center gap-2 text-sm text-zinc-400 hover:text-white ${focusRing}`}
        >
          <Settings2 className="size-4" aria-hidden="true" /> Control room
        </Link>
      </header>
      <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-16">
        <div>
          <p className="mb-5 flex items-center gap-3 font-display text-xs uppercase tracking-[0.22em] text-zinc-400">
            <span className="h-px w-8 bg-lamp" /> Selected for you. Hosted by AI.
          </p>
          <h1 className="max-w-lg text-5xl leading-[1.08] font-medium tracking-tight sm:text-6xl">
            Your mood.
            <br />
            Your music.
            <br />
            <span className="text-lamp">Your kind of radio.</span>
          </h1>
          <p className="mt-5 mb-8 max-w-md text-base leading-relaxed text-zinc-400">
            Give your DJ a direction. Get a show with records worth hearing and a voice to connect them.
          </p>

          <Card className="flex flex-col gap-4 !rounded-2xl !bg-zinc-900/40 !p-5 sm:!p-6">
            <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
              <label htmlFor="show-request" className="text-sm font-medium text-zinc-200">
                What should your show sound like?
              </label>
              <textarea
                id="show-request"
                disabled={working}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="A late-night drive. Warm jazz, a little soul, nothing in a hurry."
                rows={3}
                required
                maxLength={500}
                className={`w-full resize-none rounded-xl border border-zinc-800 bg-zinc-950/70 p-4 text-base leading-relaxed text-zinc-200 transition placeholder:text-zinc-500 hover:border-zinc-700 ${focusRing}`}
              />
              <div className="mb-2 flex flex-wrap gap-2" aria-label="Request ideas">
                {[
                  ["After hours", "A late-night drive. Warm jazz, a little soul, nothing in a hurry."],
                  [
                    "Sunday morning",
                    "An easy Sunday morning with acoustic folk, soft soul, and a few lovely surprises.",
                  ],
                  ["Deep cuts", "Take me beyond the hits: overlooked records and deep cuts from 1970s rock."],
                ].map(([label, ask]) => (
                  <button
                    key={label}
                    type="button"
                    disabled={working}
                    onClick={() => setPrompt(ask)}
                    className={`min-h-9 rounded-full border border-zinc-700/70 px-3 text-xs text-zinc-400 transition hover:border-lamp/50 hover:text-lamp disabled:opacity-50 ${focusRing}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
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
                  className={`flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-lamp px-4 py-2.5 text-sm font-semibold text-zinc-950 transition hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100 ${focusRing}`}
                >
                  {working ? "Creating…" : "Create a show"}
                  {!working && <ArrowRight className="size-4" strokeWidth={2} aria-hidden="true" />}
                </button>
              </div>
            </form>
            {djs.length === 0 && (
              <p className="text-xs text-amber-300/90">
                Your station needs a DJ.{" "}
                <Link href="/settings?voice=new" className={`underline ${focusRing}`}>
                  Add a voice in the control room.
                </Link>
              </p>
            )}
            {state.phase === "error" && (
              <p role="alert" className="station-error">
                {state.message}
              </p>
            )}
          </Card>
          <p className="mt-4 text-xs leading-relaxed text-zinc-500">
            Choose your host, then press play when the opening track is ready.
          </p>
        </div>

        <aside className="flex min-w-0 flex-col gap-5 lg:pt-2">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
            <Label>Your shows</Label>
            <span className="font-mono text-xs text-zinc-500">
              {String(sessions.length).padStart(2, "0")}
            </span>
          </div>
          {sessions.length === 0 && (
            <div className="rounded-2xl border border-dashed border-zinc-800 p-6">
              <Radio className="mb-4 size-7 text-zinc-600" strokeWidth={1.25} aria-hidden="true" />
              <p className="text-sm text-zinc-300">Your first show starts here.</p>
              <p className="mt-2 text-sm leading-relaxed text-zinc-500">
                Past shows stay on the dial. Come back for a favorite whenever the mood returns.
              </p>
            </div>
          )}
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
                      {s.dj} · {s.slots === 0 ? "new show" : `${s.slots} track${s.slots === 1 ? "" : "s"}`}
                    </span>
                  </span>
                  <span className="line-clamp-2 text-base leading-relaxed text-zinc-300">{s.prompt}</span>
                </Link>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </main>
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
