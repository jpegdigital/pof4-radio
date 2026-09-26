"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { canContinue } from "../../../(app)/sessions/[id]/continuation";
import { nextMove } from "../../../(app)/sessions/[id]/loop";
import { useMediaSession } from "../../../(app)/sessions/[id]/media-session";
import { moveCompleted, type Preparation, preparation } from "../../../(app)/sessions/[id]/preparation";
import { onMic, prevTarget, RESTART_AFTER_MS } from "../../../(app)/sessions/[id]/transport";
import { type Cue, clockMsNow, isCue, type SessionDoc, type Slot } from "../../../(app)/sessions/[id]/types";
import { type Deck, trackUrlOf, useDeck } from "../../../(app)/sessions/[id]/use-deck";

/**
 * The show's machine for the booth: the same one the session page runs (session-view.tsx), a
 * second copy by the house rule — WET until a third view wants it. GET the snapshot, ask the
 * frontier (loop.ts) for the one call it wants, POST it, fold the response in, repeat; pull each
 * pick's track the moment it is known; hand an ended track to the next voiced slot. The deck, the
 * lock screen and the transport rules are the session page's own modules, imported, not copied.
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

type SlotAnswer = (Slot & { error?: undefined }) | { error?: string; slot?: Slot } | null;

export interface Show {
  state: State;
  deck: Deck;
  slots: Slot[];
  cues: Cue[];
  /** The deck's cue, or the first playable one before play. */
  cue: Cue | null;
  nextCue: Cue | null;
  /** The slot after the cue, whatever its status: what the DJ has lined up. */
  upcoming: Slot | undefined;
  prep: Preparation;
  talking: boolean;
  running: boolean;
  canPrev: boolean;
  pullError: string | null;
  retrying: boolean;
  toggle: () => void;
  prev: () => void;
  next: () => void;
  retryProduction: () => void;
  retryPull: () => void;
}

export function useShow(id: string): Show {
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

  const onSlot = useCallback((slot: Slot) => {
    setState((s) => {
      if (s.phase !== "ready") return s;
      const slots = s.session.slots.map((x) => (x.seq === slot.seq ? slot : x));
      return { ...s, session: { ...s.session, slots } };
    });
  }, []);

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
  const upcoming =
    state.phase === "ready" && cueSeq !== null
      ? state.session.slots.find((slot) => slot.seq === cueSeq + 1)
      : undefined;
  const preloading = deck.phase === "playing" || deck.phase === "paused";
  const preload = deck.preload;
  useEffect(() => {
    if (preloading) preload(upcoming?.held && isCue(upcoming) ? upcoming : null);
  }, [preloading, upcoming, preload]);

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
              produceError: { key: failed.key, message: err instanceof Error ? err.message : String(err) },
            }
          : s,
      );
    } finally {
      setRetrying(false);
    }
  };

  const slots = state.phase === "ready" ? state.session.slots : NO_SLOTS;
  const cues = useMemo<Cue[]>(() => slots.filter(isCue), [slots]);
  const cue = (deck.cue ? (cues.find((c) => c.seq === deck.cue?.seq) ?? deck.cue) : cues[0]) ?? null;
  const index = cue ? cues.findIndex((c) => c.seq === cue.seq) : -1;
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
  const deckLoad = deck.load;
  useEffect(() => {
    if (canContinue(waiting ? cueSeq : null, cueSeq, deck.phase !== "waiting", nextCue !== null) && nextCue) {
      deckLoad(nextCue);
    }
  }, [waiting, cueSeq, deck.phase, nextCue, deckLoad]);
  useMediaSession({
    cue: deck.cue,
    phase: deck.phase,
    track: deck.track,
    operationId: deck.operationId,
    intent: deck.intent,
    onPlay: () => {
      deck.unlock();
      if (deck.cue) deck.play();
      else if (cue) go(cue);
    },
    onPause: deck.pause,
    onPrev: prev,
    onNext: next,
  });

  const running = deck.phase === "playing";
  const talking = running && deck.plan !== null && onMic(deck.plan, deck.headMs);
  const prep = preparation(cue ?? slots[0], {
    opening: state.phase === "loading",
    failed: state.phase === "error" || (state.phase === "ready" && !!state.produceError),
    downloadFailed: !!(cue && !cue.held && pullErrors[cue.seq]),
    observing: state.phase === "ready" && !!state.producing?.observing,
  });

  return {
    state,
    deck,
    slots,
    cues,
    cue,
    nextCue,
    upcoming: cue ? slots.find((s) => s.seq === cue.seq + 1) : undefined,
    prep,
    talking,
    running,
    canPrev: index > 0 || deck.headMs > RESTART_AFTER_MS,
    pullError: cue && !cue.held ? (pullErrors[cue.seq] ?? null) : null,
    retrying,
    toggle,
    prev,
    next,
    retryProduction: () => void retryProduction(),
    retryPull: () => {
      if (cue) pull(cue.seq);
    },
  };
}
