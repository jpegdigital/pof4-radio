"use client";

import { use, useEffect, useState } from "react";

/**
 * A session's home: GET the snapshot, render what exists. Fresh redirect and year-old link are
 * the same page — it reads the document and paints it. Production (segments, voicing) will hang
 * off this page in later steps; today it shows the playlist, the rationale and the receipts.
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
  | { phase: "ready"; session: SessionDoc }
  | { phase: "error"; message: string };

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [state, setState] = useState<State>({ phase: "loading" });

  useEffect(() => {
    let stale = false;
    (async () => {
      try {
        const res = await fetch(`/api/sessions/${id}`);
        const data = (await res.json().catch(() => null)) as SessionDoc | { error?: string } | null;
        if (stale) return;
        if (!res.ok || !data || !("sessionId" in data)) {
          const message =
            data && "error" in data && typeof data.error === "string" ? data.error : `HTTP ${res.status}`;
          setState({ phase: "error", message });
          return;
        }
        setState({ phase: "ready", session: data });
      } catch (err) {
        if (!stale) setState({ phase: "error", message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      stale = true;
    };
  }, [id]);

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
          {state.session.segments.map((seg) => (
            <div key={seg.num} className="flex flex-col gap-4">
              {seg.status === "open" ? (
                <p className="text-sm text-zinc-500">Segment {seg.num} — nothing produced yet.</p>
              ) : (
                <>
                  {seg.rationale && (
                    <p className="text-sm leading-relaxed text-zinc-400">{seg.rationale}</p>
                  )}
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
