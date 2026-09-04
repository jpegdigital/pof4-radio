"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, focusRing, Label } from "../../lib/ui";
import { nextMove } from "./loop";
import { Player } from "./player";
import { Rundown } from "./rundown";
import { onMic, prevTarget, RESTART_AFTER_MS } from "./transport";
import { type Cue, clockMsNow, cueKey, isCue, KIND_LABEL, type SessionDoc, type Slot } from "./types";
import { trackUrlOf, useDeck } from "./use-deck";

/**
 * A session's home, on one page: the desk (the lamp, the request), the player, the show. The
 * browser is the whole state machine. Production: GET the snapshot, ask the frontier (loop.ts)
 * for the one call it wants — a fill when the rundown runs low, else the first unvoiced slot,
 * one ahead of the cue in the deck — POST it, fold the response in, repeat; the response is the
 * product, no polling. A slot that comes back with a pick the bucket does not hold has its track
 * pulled at once, not awaited, so it is in the bucket by the time it is up. Each move is made
 * once per page life (a failure stays on screen, a reload retries); a 409 means another producer
 * holds the session.
 *
 * Playback: the deck (use-deck.ts) holds one cue. The transport starts and stops it; ⏮ ⏭ and a
 * tap on a row pick which slot; when the track ends the next voiced slot goes in on its own, its
 * track already pulled while this one played. The clip can be voiced again from its row — the
 * same words read with the roster as it stands now; if that cue is in the deck the new take
 * plays at once.
 */

type Producing = { key: string; seq: number | null; label: string };

type State =
  | { phase: "loading" }
  | { phase: "ready"; session: SessionDoc; producing: Producing | null; produceError: string | null }
  | { phase: "error"; message: string };

const NO_SLOTS: Slot[] = [];

/** A response that is the slot, or an error that may still carry the slot as written (R2). */
type SlotAnswer = (Slot & { error?: undefined }) | { error?: string; slot?: Slot } | null;

export function SessionView({ id }: { id: string }) {
  const [state, setState] = useState<State>({ phase: "loading" });
  const attempted = useRef(new Set<string>());
  const ended = useRef<() => void>(() => {});

  const load = useCallback(async (): Promise<SessionDoc> => {
    const res = await fetch(`/api/sessions/${id}`);
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
      fetch(trackUrlOf(id, seq), { method: "POST" })
        .then(async (res) => {
          const data = (await res.json().catch(() => null)) as { held?: boolean; error?: string } | null;
          if (!res.ok || !data?.held) throw new Error(data?.error ?? `HTTP ${res.status}`);
          setState((s) => {
            if (s.phase !== "ready") return s;
            const slots = s.session.slots.map((x) => (x.seq === seq ? { ...x, held: true } : x));
            return { ...s, session: { ...s.session, slots } };
          });
        })
        .catch((err: unknown) => console.warn(`[session] slot ${seq} track pull:`, err));
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

  const deck = useDeck({ sessionId: id, onSlot, onEnded: () => ended.current() });
  const cueSeq = deck.cue?.seq ?? null;

  // The machine's one move: what the frontier asks for, once per page life.
  useEffect(() => {
    if (state.phase !== "ready" || state.producing !== null) return;
    const move = nextMove(state.session.slots, state.session.clock, cueSeq, attempted.current);
    if (!move) return;
    attempted.current.add(move.key);
    const producing: Producing =
      move.kind === "fill"
        ? { key: move.key, seq: null, label: "filling…" }
        : { key: move.key, seq: move.seq, label: `writing slot ${move.seq}…` };
    setState({ ...state, producing, produceError: null });
    (async () => {
      let error: string | null = null;
      if (move.kind === "fill") {
        const res = await fetch(`/api/sessions/${id}/fill`, { method: "POST" });
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
        });
        const data = (await res.json().catch(() => null)) as SlotAnswer;
        const slot = data && "seq" in data ? data : (data?.slot ?? null);
        if (!res.ok) error = data?.error ?? `HTTP ${res.status}`;
        if (slot) {
          onSlot(slot);
          if (slot.pick && !slot.held) pull(slot.seq);
        }
      }
      setState((s) => (s.phase === "ready" ? { ...s, producing: null, produceError: error } : s));
    })().catch((err) => {
      setState({ phase: "error", message: err instanceof Error ? err.message : String(err) });
    });
  }, [state, cueSeq, id, onSlot, pull]);

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
  const cue = deck.cue ?? cues[0] ?? null;
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
  // The track ended on its own: the next slot goes in, if it is ready.
  const deckLoad = deck.load;
  useEffect(() => {
    ended.current = () => {
      if (deck.phase === "playing" && nextCue) deckLoad(nextCue);
    };
  });

  const running = deck.phase === "playing";
  const talking = running && deck.plan !== null && onMic(deck.plan, deck.headMs);
  const status = (() => {
    if (deck.phase === "loading") return "Loading…";
    if (deck.phase === "paused") return "Paused";
    if (deck.phase === "error") return "Stopped";
    if (!running || !deck.cue) return "Off air";
    return `${KIND_LABEL[deck.cue.kind]} · slot ${deck.cue.seq} of ${slots.length}`;
  })();
  // The track ran out and the next slot is not voiced yet: say so rather than go silent.
  const waiting = deck.phase === "playing" && deck.track?.playing === false && after && !nextCue;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pt-5 pb-10">
      <h1 className="font-display text-2xl font-semibold uppercase tracking-[0.18em]">
        <Link href="/" className={`rounded-sm transition hover:text-lamp ${focusRing}`}>
          Claude Radio
        </Link>
      </h1>

      {/* the desk: the lamp; the request under it */}
      <Card className="flex flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className={`lamp size-2.5 rounded-full ${running ? "on" : ""} ${talking ? "talking" : ""}`}
          />
          <Label className={running ? "text-lamp" : ""}>{running ? "On air" : "Off air"}</Label>
        </div>
        {state.phase === "ready" && (
          <p className="font-mono text-sm leading-relaxed text-zinc-300">{state.session.prompt}</p>
        )}
      </Card>

      {state.phase === "loading" && <p className="text-sm text-zinc-500">Loading the session…</p>}
      {state.phase === "error" && (
        <p className="rounded-xl border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
          {state.message}
        </p>
      )}
      {state.phase === "ready" && state.produceError && (
        <p className="rounded-xl border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
          {state.produceError}
        </p>
      )}
      {retake?.error && (
        <p className="rounded-xl border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
          Couldn&rsquo;t voice it again: {retake.error}. The slot keeps its last take.
        </p>
      )}
      {deck.phase === "error" && deck.message && (
        <p className="rounded-xl border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
          {deck.message} — press play to try the slot again.
        </p>
      )}

      {/* the player: mounted from the first written slot on, never unmounts */}
      {cue && (
        <Card className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <Label>Now playing</Label>
            <span className={`text-xs ${running ? "text-zinc-300" : "text-zinc-500"}`}>{status}</span>
          </div>
          <Player
            cue={cue}
            phase={deck.phase}
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
          {waiting && <p className="text-xs text-zinc-500">Loading the next slot…</p>}
        </Card>
      )}

      {state.phase === "ready" && (
        <Rundown
          slots={slots}
          producing={state.producing ? { seq: state.producing.seq, label: state.producing.label } : null}
          cursor={deck.cue ? cueKey(deck.cue) : null}
          retaking={retake && !retake.error ? retake.key : null}
          onPick={go}
          onRetake={revoice}
        />
      )}
    </div>
  );
}
