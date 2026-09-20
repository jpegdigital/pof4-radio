"use client";

import { ArrowRight, ChevronRight, Disc3, Headphones, Radio, Settings2, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore } from "react";
import { DjPicker } from "./lib/dj-picker";
import { focusRing } from "./lib/ui";
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

type State =
  | { phase: "idle" }
  | { phase: "working" }
  | { phase: "opening"; sessionId: string }
  | { phase: "error"; message: string };

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
  const submitting = useRef(false);

  async function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    if (submitting.current || !prompt.trim() || !dj.id) return;
    submitting.current = true;
    setState({ phase: "working" });
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, voiceId: dj.id }),
      });
      const data = (await res.json().catch(() => null)) as { sessionId?: string; error?: string } | null;
      if (!res.ok || !data?.sessionId) {
        setState({ phase: "error", message: data?.error ?? `HTTP ${res.status}` });
        submitting.current = false;
        return;
      }
      setState({ phase: "opening", sessionId: data.sessionId });
      // Keep the saved id and the direct link even if client navigation fails.
      try {
        router.push(`/sessions/${data.sessionId}`);
      } catch {
        /* Open show remains available. */
      }
    } catch (err) {
      submitting.current = false;
      setState({
        phase: "error",
        message:
          err instanceof Error && err.name === "TimeoutError"
            ? "We couldn’t confirm whether your show was saved. Refresh Your shows before creating another."
            : err instanceof Error
              ? err.message
              : String(err),
      });
    }
  }

  const working = state.phase === "working" || state.phase === "opening";
  const canStart = prompt.trim().length > 0 && dj.id !== "" && !working;

  return (
    <main className="station-shell home-screen">
      <header className="station-header">
        <span className="station-wordmark">
          <Radio aria-hidden="true" /> Claude<span>Radio</span>
        </span>
        <Link href="/settings" aria-label="Control room" className={"station-icon " + focusRing}>
          <Settings2 className="size-5" aria-hidden="true" />
        </Link>
      </header>
      <section className="frequency-hero" aria-labelledby="home-title">
        <div className="retro-landscape" aria-hidden="true">
          <div className="retro-sun" />
          <div className="retro-mountains" />
          <div className="retro-grid" />
        </div>
        <p className="station-eyebrow">
          <span className="signal-dot" /> A frequency of your own
        </p>
        <h1 id="home-title">
          Good music.
          <br />
          <em>Your wavelength.</em>
        </h1>
        <p>Your mood. Your DJ. Your kind of radio.</p>
        <div className="frequency-scale" aria-hidden="true">
          <span>88</span>
          <span>92</span>
          <span>96</span>
          <span>100</span>
          <span>104</span>
          <span>108</span>
        </div>
      </section>
      <section id="tune-in" className="request-card" aria-labelledby="request-title">
        <div className="section-heading">
          <h2 id="request-title">Set the mood</h2>
          <Sparkles className="size-4 text-lamp" aria-hidden="true" />
        </div>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
          <label htmlFor="show-request" className="sr-only">
            What should your show sound like?
          </label>
          <textarea
            id="show-request"
            disabled={working}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Late-night drives, neon lights, and a little 80s nostalgia…"
            rows={3}
            required
            maxLength={500}
            className={"request-input " + focusRing}
          />
          <div className="mood-presets" aria-label="Request ideas">
            {[
              [
                "Neon nights",
                "An 80s night drive with shimmering synths, new wave, and a few forgotten gems. The convertible top is down.",
              ],
              [
                "Slow Sunday",
                "An easy Sunday morning with acoustic folk, soft soul, and a few lovely surprises.",
              ],
              ["Deep cuts", "Take me beyond the hits: overlooked records and deep cuts from 1970s rock."],
            ].map(([label, ask]) => (
              <button
                key={label}
                type="button"
                disabled={working}
                aria-pressed={prompt === ask}
                onClick={() => setPrompt(ask)}
                className={"mood-chip " + focusRing}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="host-field">
            <span>On the mic</span>
            <DjPicker
              disabled={working}
              djs={djs}
              value={dj}
              onChange={(d) => {
                setPicked(d);
                saveDj(d);
              }}
            />
          </div>
          <button type="submit" disabled={!canStart} className={"tune-button " + focusRing}>
            <Radio className="size-5" aria-hidden="true" />
            {state.phase === "opening" ? "Opening show…" : working ? "Creating show…" : "Create my show"}
            {!working && <ArrowRight className="ml-auto size-5" aria-hidden="true" />}
          </button>
        </form>
        {working && (
          <p role="status" className="mt-3 text-sm text-zinc-400">
            {state.phase === "opening" ? (
              <>
                Your show is saved.{" "}
                <a
                  href={"/sessions/" + state.sessionId}
                  className={"inline-flex min-h-11 items-center text-lamp underline " + focusRing}
                >
                  Open show
                </a>
              </>
            ) : (
              "Saving your request and DJ…"
            )}
          </p>
        )}
        {djs.length === 0 && (
          <p className="mt-3 text-sm text-amber-200">
            Your station needs a DJ.{" "}
            <Link
              href="/settings?voice=new"
              className={"inline-flex min-h-11 items-center underline " + focusRing}
            >
              Add a voice in the control room.
            </Link>
          </p>
        )}
        {state.phase === "error" && (
          <p role="alert" className="station-error mt-3">
            {state.message}
          </p>
        )}
      </section>
      <p className="composer-note">A show made for you. Press play when it’s ready.</p>
      <section id="your-shows" className="show-library" aria-labelledby="shows-title">
        <div className="section-heading">
          <h2 id="shows-title">Your shows</h2>
          <span className="station-count">{String(sessions.length).padStart(2, "0")}</span>
        </div>
        {sessions.length === 0 ? (
          <div className="empty-library">
            <Headphones className="size-7 text-lamp" aria-hidden="true" />
            <p>Your first great find is waiting.</p>
            <span>Create a show. It’ll always be here to come back to.</span>
          </div>
        ) : (
          <ol className="show-list">
            {sessions.map((s, index) => (
              <li key={s.sessionId}>
                <Link href={"/sessions/" + s.sessionId} className={"show-link " + focusRing}>
                  <span className={"show-art show-art-" + (index % 3)} aria-hidden="true">
                    <Disc3 className="size-7" strokeWidth={1.2} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="show-title">{s.prompt}</span>
                    <span className="show-meta">
                      {s.dj} · {s.slots === 0 ? "New show" : s.slots + " tracks"}
                    </span>
                    <time dateTime={s.createdAt} suppressHydrationWarning className="show-date">
                      {when(s.createdAt)}
                    </time>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-zinc-400" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>
      <footer className="station-signoff">
        <span /> Stay on your wavelength <span />
      </footer>
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
