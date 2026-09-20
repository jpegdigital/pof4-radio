"use client";

import Link from "next/link";
import { ArrowLeft, Headphones, ListMusic, MessageSquareText, Radio, Settings2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { focusRing, Label } from "../../lib/ui";
import { nextMove } from "./loop";
import { canContinue } from "./continuation";
import { useMediaSession } from "./media-session";
import { Player } from "./player";
import { moveCompleted, preparation } from "./preparation";
import { PreparationProgress } from "./preparation-progress";
import { Rundown } from "./rundown";
import { onMic, prevTarget, RESTART_AFTER_MS } from "./transport";
import { type Cue, clockMsNow, cueKey, isCue, type SessionDoc, type Slot } from "./types";
import { trackUrlOf, useDeck } from "./use-deck";

/**
 * A session's home, on one page: the desk (the lamp, the request), the player, the show. The
 * browser is the whole state machine. Production: GET the snapshot, ask the frontier (loop.ts)
 * for the one call it wants — a fill when the rundown runs low, else the first unvoiced slot,
 * one ahead of the cue in the deck — POST it, fold the response in, repeat; the response is the
 * product; only lock conflicts trigger bounded snapshot checks. A slot with a pick the bucket does not hold has its track
 * pulled at once, not awaited, so it is in the bucket by the time it is up. Each move is made
 * once until explicitly retried. Retry refreshes the snapshot first; a 409 means another
 * producer holds the session. Download errors are attached to their own rundown rows.
 *
 * Playback: the deck (use-deck.ts) holds one cue. The transport starts and stops it; ⏮ ⏭ and a
 * tap on a row pick which slot; when the track ends the next voiced slot goes in on its own, its
 * track already pulled while this one played. An ended deck waits for a late next slot and can
 * be paused while it waits. The clip can be voiced again from its row's details — the
 * same words read with the roster as it stands now; if that cue is in the deck the new take
 * plays at once. The lock screen (media-session.ts) shows the cue and drives the same transport.
 */

type Producing = { key: string; seq: number | null; label: string; observing?: boolean };

type State =
  | { phase: "loading" }
  | {
      phase: "ready";
      session: SessionDoc;
      producing: Producing | null;
      produceError: { key: string; message: string } | null;
    }
  | { phase: "error"; message: string };

const NO_SLOTS: Slot[] = [];

/** A response that is the slot, or an error that may still carry the slot as written (R2). */
type SlotAnswer = (Slot & { error?: undefined }) | { error?: string; slot?: Slot } | null;

export function SessionView({ id }: { id: string }) {
  const [state, setState] = useState<State>({ phase: "loading" });
  const attempted = useRef(new Set<string>());
  const [pullErrors, setPullErrors] = useState<Record<number, string>>({});
  const [retrying, setRetrying] = useState(false);
  const pulls = useRef(new Set<number>());
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);

  const load = useCallback(async (): Promise<SessionDoc> => {
    const res = await fetch(`/api/sessions/${id}`, {
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => null)) as SessionDoc | { error?: string } | null;
    if (!res.ok || !data || !("sessionId" in data)) {
      const message =
        data && "error" in data && typeof data.error === "string" ? data.error : `HTTP ${res.status}`;
      throw new Error(message);
    }
    return data;
  }, [id]);

  /** A slot came back from a rung: fold it into the document in place. */
  const onSlot = useCallback((slot: Slot) => {
    setState((s) => {
      if (s.phase !== "ready") return s;
      const slots = s.session.slots.map((x) => (x.seq === slot.seq ? slot : x));
      return { ...s, session: { ...s.session, slots } };
    });
  }, []);

  /** The slot's track, pulled into the bucket now rather than when it is up; not awaited. */
  const pull = useCallback(
    (seq: number) => {
      if (pulls.current.has(seq)) return;
      pulls.current.add(seq);
      setPullErrors((errors) => {
        const next = { ...errors };
        delete next[seq];
        return next;
      });
      fetch(trackUrlOf(id, seq), { method: "POST", signal: AbortSignal.timeout(90_000) })
        .then(async (res) => {
          const data = (await res.json().catch(() => null)) as { held?: boolean; error?: string } | null;
          if (!res.ok || !data?.held) throw new Error(data?.error ?? `HTTP ${res.status}`);
          setState((s) => {
            if (s.phase !== "ready") return s;
            const slots = s.session.slots.map((x) => (x.seq === seq ? { ...x, held: true } : x));
            return { ...s, session: { ...s.session, slots } };
          });
        })
        .catch((err: unknown) => {
          setPullErrors((errors) => ({ ...errors, [seq]: err instanceof Error ? err.message : String(err) }));
        })
        .finally(() => pulls.current.delete(seq));
    },
    [id],
  );

  useEffect(() => {
    let stale = false;
    load()
      .then((session) => {
        if (stale) return;
        setState({ phase: "ready", session, producing: null, produceError: null });
        // A pick the bucket does not hold yet (a pull that failed, or a reload mid-pull): ask again now.
        for (const s of session.slots) if (s.pick && !s.held) pull(s.seq);
      })
      .catch((err) => {
        if (!stale) setState({ phase: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      stale = true;
    };
  }, [load, pull]);

  const deck = useDeck({ sessionId: id, onSlot });
  const cueSeq = deck.cue?.seq ?? null;
  const waiting = deck.ended;

  // The machine's one move: what the frontier asks for, once until an explicit retry.
  useEffect(() => {
    if (state.phase !== "ready" || state.producing !== null || state.produceError) return;
    const move = nextMove(state.session.slots, state.session.clock, cueSeq, attempted.current);
    if (!move) return;
    attempted.current.add(move.key);
    const signal = lifetime.current!.signal;
    const producing: Producing =
      move.kind === "fill"
        ? { key: move.key, seq: null, label: "Selecting your next tracks…" }
        : {
            key: move.key,
            seq: move.seq,
            label: move.seq === 1 ? "Preparing your opening…" : "Preparing the DJ’s introduction…",
          };
    setState({ ...state, producing, produceError: null });
    // A lock conflict means another browser is doing the work. Observe only, with bounded checks.
    const observe = async () => {
      setState((s) =>
        s.phase === "ready"
          ? {
              ...s,
              producing: {
                ...producing,
                observing: true,
                label: "Your show is being prepared in another tab…",
              },
            }
          : s,
      );
      for (let attempt = 0; attempt < 12; attempt++) {
        await new Promise<void>((resolve) => {
          const done = () => {
            window.clearTimeout(timer);
            signal.removeEventListener("abort", done);
            resolve();
          };
          const timer = window.setTimeout(done, 5_000);
          signal.addEventListener("abort", done, { once: true });
          if (signal.aborted) done();
        });
        if (signal.aborted) return;
        const session = await load();
        if (signal.aborted) return;
        const complete = moveCompleted(move.key, session.slots);
        setState((s) =>
          s.phase === "ready" ? { ...s, session, producing: complete ? null : s.producing } : s,
        );
        for (const slot of session.slots) if (slot.pick && !slot.held) pull(slot.seq);
        if (complete) return;
      }
      throw new Error(
        "Another tab may still be preparing your show. Retry to check its progress before continuing.",
      );
    };
    (async () => {
      let error: string | null = null;
      if (move.kind === "fill") {
        const res = await fetch(`/api/sessions/${id}/fill`, {
          method: "POST",
          signal: AbortSignal.timeout(120_000),
        });
        if (signal.aborted) return;
        if (res.status === 409) return observe();
        const data = (await res.json().catch(() => null)) as { added?: Slot[]; error?: string } | null;
        if (!res.ok || !data?.added) error = data?.error ?? `HTTP ${res.status}`;
        else {
          const added = data.added;
          setState((s) =>
            s.phase === "ready"
              ? { ...s, session: { ...s.session, slots: [...s.session.slots, ...added] } }
              : s,
          );
        }
      } else {
        const res = await fetch(`/api/sessions/${id}/slots/${move.seq}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ clockMs: clockMsNow() }),
          signal: AbortSignal.timeout(120_000),
        });
        if (signal.aborted) return;
        if (res.status === 409) return observe();
        const data = (await res.json().catch(() => null)) as SlotAnswer;
        const slot = data && "seq" in data ? data : (data?.slot ?? null);
        if (!res.ok || !slot)
          error =
            data?.error ??
            (res.ok ? "The DJ’s response was incomplete. Please try again." : `HTTP ${res.status}`);
        if (slot) {
          onSlot(slot);
          if (slot.pick && !slot.held) pull(slot.seq);
        }
      }
      setState((s) =>
        s.phase === "ready"
          ? { ...s, producing: null, produceError: error ? { key: move.key, message: error } : null }
          : s,
      );
    })().catch((err) => {
      if (signal.aborted) return;
      setState((s) =>
        s.phase === "ready"
          ? {
              ...s,
              producing: null,
              produceError: {
                key: move.key,
                message:
                  err instanceof Error && err.name === "TimeoutError"
                    ? "We couldn’t confirm that preparation finished. Retry to check your saved progress first."
                    : err instanceof Error
                      ? err.message
                      : String(err),
              },
            }
          : s,
      );
    });
  }, [state, cueSeq, id, onSlot, pull, load]);

  // Refresh before retrying: another tab may have finished the request that failed here.
  const retryProduction = async () => {
    if (state.phase !== "ready" || !state.produceError || retrying) return;
    const failed = state.produceError;
    setRetrying(true);
    try {
      const session = await load();
      attempted.current.delete(failed.key);
      setState({ phase: "ready", session, producing: null, produceError: null });
      for (const slot of session.slots) if (slot.pick && !slot.held) pull(slot.seq);
    } catch (err) {
      setState((s) =>
        s.phase === "ready"
          ? {
              ...s,
              produceError: {
                key: failed.key,
                message: err instanceof Error ? err.message : String(err),
              },
            }
          : s,
      );
    } finally {
      setRetrying(false);
    }
  };

  // Another take of a slot's clip: POST again, fold the row in, and hear it if it is the cue in the deck.
  const [retake, setRetake] = useState<{ key: string; error: string | null } | null>(null);
  const revoice = (c: Cue) => {
    const key = cueKey(c);
    const inDeck = deck.cue !== null && cueKey(deck.cue) === key;
    setRetake({ key, error: null });
    (async () => {
      const res = await fetch(`/api/sessions/${id}/slots/${c.seq}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clockMs: clockMsNow(), again: true }),
      });
      const data = (await res.json().catch(() => null)) as SlotAnswer;
      if (!res.ok || !data || !("seq" in data))
        throw new Error(data && "error" in data && data.error ? data.error : `HTTP ${res.status}`);
      onSlot(data);
      setRetake(null);
      if (inDeck && isCue(data)) deck.load(data);
    })().catch((err: unknown) => {
      setRetake({ key, error: err instanceof Error ? err.message : String(err) });
    });
  };

  // Every slot with a pick, in show order; the deck's cue or the first of them is what the player shows.
  const slots = state.phase === "ready" ? state.session.slots : NO_SLOTS;
  const cues = useMemo<Cue[]>(() => slots.filter(isCue), [slots]);
  const cue = (deck.cue ? (cues.find((c) => c.seq === deck.cue?.seq) ?? deck.cue) : cues[0]) ?? null;
  const index = cue ? cues.findIndex((c) => c.seq === cue.seq) : -1;
  // What ⏭ and the end of a track go to: the next slot, once it is voiced and can play.
  const after = cues[index + 1];
  const nextCue = after && after.status === "voiced" ? after : null;

  // The unlock must stay inside the tap: the graph and its elements first make sound in a gesture.
  const go = (c: Cue) => {
    deck.unlock();
    deck.load(c);
  };
  const toggle = () => {
    deck.unlock();
    if (deck.cue) deck.toggle();
    else if (cue) go(cue);
  };
  const prev = () => {
    const target = cues[prevTarget(index, deck.headMs)];
    if (target) go(target);
  };
  const next = () => {
    if (nextCue) go(nextCue);
  };
  // Readiness can change after the end, including after a failed request is retried.
  const deckLoad = deck.load;
  useEffect(() => {
    if (canContinue(waiting ? cueSeq : null, cueSeq, deck.phase !== "waiting", nextCue !== null) && nextCue) {
      deckLoad(nextCue);
    }
  }, [waiting, cueSeq, deck.phase, nextCue, deckLoad]);
  const phase = deck.phase;
  // The lock screen shows the cue and its buttons work the same transport.
  useMediaSession({
    cue: deck.cue,
    phase,
    track: deck.track,
    onToggle: toggle,
    onPrev: prev,
    onNext: next,
  });

  const running = phase === "playing";
  const talking = running && deck.plan !== null && onMic(deck.plan, deck.headMs);
  const first = slots[0];
  const prep = preparation(cue ?? first, {
    opening: state.phase === "loading",
    failed: state.phase === "error" || (state.phase === "ready" && !!state.produceError),
    downloadFailed: !!(cue && !cue.held && pullErrors[cue.seq]),
    observing: state.phase === "ready" && !!state.producing?.observing,
  });
  const status = (() => {
    if (deck.phase === "loading") return "Loading audio…";
    if (deck.phase === "paused") return "Paused";
    if (deck.phase === "held") return "Interrupted";
    if (deck.phase === "error") return "Stopped";
    if (state.phase === "error") return "Unable to open show";
    if (state.phase === "ready" && state.produceError && (waiting || !prep.ready))
      return "Preparation needs another try";
    if (waiting) return "Preparing the next track…";
    if (!running || !deck.cue) return prep.label;
    return talking ? "Your DJ is on the mic" : "On air";
  })();

  return (
    <main className="station-shell session-screen">
      <header className="station-header">
        <Link href="/" aria-label="All shows" className={"station-icon " + focusRing}>
          <ArrowLeft className="size-5" aria-hidden="true" />
        </Link>
        <Link href="/" className={"station-wordmark " + focusRing}>
          <Radio aria-hidden="true" /> Claude<span>Radio</span>
        </Link>
        <Link href="/settings" aria-label="Control room" className={"station-icon " + focusRing}>
          <Settings2 className="size-5" aria-hidden="true" />
        </Link>
      </header>
      <div className="session-content">
        <div className="min-w-0">
          {state.phase === "error" && (
            <div role="alert" className="station-error">
              <p>Couldn’t open this show. {state.message}</p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className={`mt-2 min-h-11 underline ${focusRing}`}
              >
                Try again
              </button>
            </div>
          )}
          {state.phase === "ready" && state.produceError && (
            <div role="alert" className="station-error">
              <p className="font-medium">The next part of your show needs another try.</p>
              <details className="mt-1 text-xs">
                <summary className={`cursor-pointer py-2 ${focusRing}`}>What happened</summary>
                {state.produceError.message}
              </details>
              <button
                type="button"
                disabled={retrying}
                onClick={() => void retryProduction()}
                className={`min-h-11 font-semibold underline disabled:opacity-50 ${focusRing}`}
              >
                {retrying ? "Trying again…" : "Retry preparation"}
              </button>
            </div>
          )}
          {retake?.error && (
            <p role="alert" className="station-error">
              Couldn&rsquo;t voice it again: {retake.error}. The slot keeps its last take.
            </p>
          )}
          {deck.phase === "error" && deck.message && (
            <p role="alert" className="station-error">
              {deck.message} — press play to try the slot again.
            </p>
          )}

          {/* the player: mounted from the first written slot on, never unmounts */}
          <section id="player" aria-label="Player" className="listening-player">
            <div className="mb-4 flex items-center justify-between gap-3">
              <span className="font-display text-xs uppercase tracking-[0.2em] text-zinc-400">
                {running ? "Now playing" : "Your station"}
              </span>
              <span
                role="status"
                aria-atomic="true"
                className="flex max-w-[65%] items-center gap-2 text-right text-xs text-zinc-300"
              >
                <span
                  aria-hidden="true"
                  className={`lamp size-2 rounded-full ${running ? "on" : ""} ${talking ? "talking" : ""}`}
                />
                {status}
              </span>
            </div>
            {cue ? (
              <Player
                cue={cue}
                preparation={prep}
                startup={
                  !deck.cue ? (
                    <PreparationProgress status={prep} loaded={state.phase === "ready"} slot={first} />
                  ) : undefined
                }
                phase={phase}
                plan={deck.plan}
                headMs={deck.headMs}
                track={deck.track}
                canPrev={index > 0 || deck.headMs > RESTART_AFTER_MS}
                canNext={nextCue !== null}
                onPrev={prev}
                onNext={next}
                onToggle={toggle}
                onScrub={deck.seek}
                onSeekTrack={deck.seekTrack}
              />
            ) : (
              <div className="flex flex-col items-center text-center">
                <div className="mb-6 w-full">
                  <PreparationProgress status={prep} loaded={state.phase === "ready"} slot={first} />
                </div>
                <div className="record-placeholder mb-6 flex aspect-square w-full max-w-64 items-center justify-center rounded-xl">
                  <Radio className="size-12 text-lamp/70" strokeWidth={1} aria-hidden="true" />
                </div>
                <h1 className="text-2xl font-medium">
                  {prep.busy ? "Preparing your show" : "Your show is waiting"}
                </h1>
                <p className="mt-2 min-h-12 text-sm text-zinc-400">
                  {prep.busy
                    ? "Your DJ is putting together the first track and its introduction."
                    : "Your request is saved. Retry to continue preparation."}
                </p>
              </div>
            )}
            {cue && !cue.held && pullErrors[cue.seq] && (
              <button
                type="button"
                onClick={() => pull(cue.seq)}
                className={`mt-2 min-h-11 w-full text-sm text-lamp underline ${focusRing}`}
              >
                Retry track download
              </button>
            )}
            {waiting && (
              <p className="mt-4 text-center text-sm text-zinc-400">
                {phase === "paused"
                  ? "Paused. Press play to continue when the next track is ready."
                  : state.phase === "ready" && state.produceError
                    ? "Preparation needs another try. Retry above to continue your show."
                    : "Your DJ is preparing what comes next. Playback will continue automatically."}
              </p>
            )}
          </section>
        </div>

        <aside className="session-details">
          {state.phase === "ready" && (
            <section id="request" className="request-summary" aria-label="Your request">
              <Label className="mb-3 !text-[#d2b8ce]">The inspiration</Label>
              <p>{state.session.prompt}</p>
              <div className="request-facts">
                <span>{slots.length} tracks in your show</span>
                <span>DJ break every {state.session.clock.breakEvery} tracks</span>
              </div>
            </section>
          )}

          {state.phase === "ready" && (
            <Rundown
              slots={slots}
              producing={state.producing ? { seq: state.producing.seq, label: state.producing.label } : null}
              cursor={deck.cue ? cueKey(deck.cue) : null}
              retaking={retake && !retake.error ? retake.key : null}
              onPick={go}
              onRetake={revoice}
              playing={running}
              pullErrors={pullErrors}
              preparationError={state.produceError?.key ?? null}
              onRetryPull={pull}
            />
          )}
        </aside>
      </div>
      <nav className="session-nav" aria-label="In this show">
        <a href="#player" className={focusRing}>
          <Headphones aria-hidden="true" />
          Player & mix
        </a>
        <a href="#rundown" className={focusRing}>
          <ListMusic aria-hidden="true" />
          Program
        </a>
        <a href="#request" className={focusRing}>
          <MessageSquareText aria-hidden="true" />
          Request
        </a>
      </nav>
    </main>
  );
}
