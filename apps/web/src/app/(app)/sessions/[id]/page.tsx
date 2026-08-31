"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";

/**
 * A session's home and its state machine: GET the snapshot, render what exists, then look at
 * the first segment still open and POST its next production rung — the response is the product,
 * no polling. Fresh redirect and year-old link are the same page: read the document, produce
 * the first missing thing. Each rung is attempted once per page life (a failure stays on
 * screen, a reload retries); a 409 means another producer holds the session.
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

interface Segment {
  num: number;
  status: "open" | "playlisted";
  rationale: string | null;
  tracks: Track[];
  dropped: string[];
}

interface SessionDoc {
  sessionId: string;
  prompt: string;
  voiceId: string;
  createdAt: string;
  segments: Segment[];
}

type State =
  | { phase: "loading" }
  | { phase: "ready"; session: SessionDoc; producing: number | null; produceError: string | null }
  | { phase: "error"; message: string };

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [state, setState] = useState<State>({ phase: "loading" });
  const attempted = useRef(new Set<number>());

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

  useEffect(() => {
    let stale = false;
    load()
      .then((session) => {
        if (!stale) setState({ phase: "ready", session, producing: null, produceError: null });
      })
      .catch((err) => {
        if (!stale) setState({ phase: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      stale = true;
    };
  }, [load]);

  // The machine's one move: the first open segment gets its playlist rung, once per page life.
  useEffect(() => {
    if (state.phase !== "ready" || state.producing !== null) return;
    const open = state.session.segments.find((s) => s.status === "open");
    if (!open || attempted.current.has(open.num)) return;
    attempted.current.add(open.num);
    setState({ ...state, producing: open.num, produceError: null });
    (async () => {
      const res = await fetch(`/api/sessions/${id}/segments/${open.num}/playlist`, { method: "POST" });
      const err = res.ok
        ? null
        : (((await res.json().catch(() => null)) as { error?: string } | null)?.error ??
          `HTTP ${res.status}`);
      const session = await load();
      setState({ phase: "ready", session, producing: null, produceError: err });
    })().catch((err) => {
      setState({ phase: "error", message: err instanceof Error ? err.message : String(err) });
    });
  }, [state, id, load]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
      <h1 className="font-display text-2xl font-semibold uppercase tracking-[0.18em]">Claude Radio</h1>

      {state.phase === "loading" && <p className="text-sm text-zinc-500">Loading session…</p>}

      {state.phase === "error" && (
        <p className="rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
          {state.message}
        </p>
      )}

      {state.phase === "ready" && (
        <div className="flex flex-col gap-6">
          <p className="text-sm text-zinc-500">“{state.session.prompt}”</p>
          {state.produceError && (
            <p className="rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
              {state.produceError}
            </p>
          )}
          {state.session.segments.map((seg) => (
            <div key={seg.num} className="flex flex-col gap-4">
              {seg.status === "open" ? (
                <p className="text-sm text-zinc-500">
                  {state.producing === seg.num
                    ? `Composing segment ${seg.num}…`
                    : `Segment ${seg.num} — nothing produced yet.`}
                </p>
              ) : (
                <>
                  {seg.rationale && <p className="text-sm leading-relaxed text-zinc-400">{seg.rationale}</p>}
                  <ol className="flex flex-col gap-2">
                    {seg.tracks.map((t, i) => (
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
                  {seg.dropped.length > 0 && (
                    <details className="text-xs text-zinc-600">
                      <summary className="cursor-pointer">{seg.dropped.length} dropped</summary>
                      <ul className="mt-2 flex flex-col gap-1">
                        {seg.dropped.map((d) => (
                          <li key={d}>{d}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
