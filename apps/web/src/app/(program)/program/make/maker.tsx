"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Usage } from "./ask";
import { type Stage, STAGES, type Station } from "./shapes";

/**
 * The maker's desk: a request in, five stages run in order (or one at a time), each showing what
 * it wrote and where. Edits to the files happen in the editor; this page only runs stages.
 */

interface Files {
  "request.json": string | null;
  "picks.json": string | null;
  cards: number;
  "log.json": string | null;
  "script.json": string | null;
  "program.json": string | null;
}

type RowState =
  | { kind: "idle" }
  | { kind: "running"; since: number }
  | { kind: "ok"; ms: number; usage?: Usage; summary: string }
  | { kind: "error"; status: number; message: string };

const FILE_OF: Record<Stage, keyof Files> = {
  discover: "picks.json",
  enrich: "cards",
  log: "log.json",
  script: "script.json",
  voice: "program.json",
};
const INPUT_OF: Record<Stage, keyof Files | null> = {
  discover: null,
  enrich: "picks.json",
  log: "cards",
  script: "log.json",
  voice: "script.json",
};
const LINK_OF: Record<Stage, string> = {
  discover: "/program/make/picks.json",
  enrich: "/program/make/picks.json",
  log: "/program/make/log.json",
  script: "/program/make/script.json",
  voice: "/program/make/program.json",
};
const ABOUT: Record<Stage, string> = {
  discover: "the request → picks → records found in the catalogue",
  enrich: "one card per record: intro, post, ending, energy (cached by id)",
  log: "the order and what happens at the top of each record",
  script: "every word that is said",
  voice: "the clips, timed, and program.json for the player",
};

/** Which stage files exist, from GET /program/make/status; null when the route isn't there (production). */
async function fetchStatus(): Promise<Files | null> {
  const r = await fetch("/program/make/status", { cache: "no-store" });
  return r.ok ? ((await r.json()) as { files: Files }).files : null;
}

/** What a stage's response says in one line. */
function summarize(stage: Stage, r: Record<string, unknown>): string {
  const n = (k: string) => (Array.isArray(r[k]) ? (r[k] as unknown[]).length : 0);
  switch (stage) {
    case "discover":
      return `${n("records")} records from ${n("picks")} picks${n("dropped") ? `, ${n("dropped")} dropped` : ""}`;
    case "enrich":
      return `${n("cards")} cards (${n("reused")} reused${n("failed") ? `, ${n("failed")} failed` : ""})`;
    case "log": {
      const slots = (r.slots as { intro: string }[] | undefined) ?? [];
      const by = new Map<string, number>();
      for (const s of slots) by.set(s.intro, (by.get(s.intro) ?? 0) + 1);
      const parts = [...by].map(([k, v]) => `${v} ${k}`).join(", ");
      return `${slots.length} slots: ${parts}${n("fallbacks") ? ` · ${n("fallbacks")} fallbacks` : ""}${n("warnings") ? ` · ${n("warnings")} warnings` : ""}`;
    }
    case "script":
      return `${n("lines")} lines`;
    case "voice": {
      const notes = (r.notes as { fallback?: unknown }[] | undefined) ?? [];
      const fell = notes.filter((x) => x.fallback).length;
      return `${n("elements")} elements, ${notes.length} clips${fell ? `, ${fell} fell back` : ""}${n("failed") ? `, ${n("failed")} clips failed` : ""}`;
    }
  }
}

export function Maker({ dj, station, startMs }: { dj: string; station: Station; startMs: number }) {
  const [request, setRequest] = useState("Saturday night 80s, Dallas, hits-forward, keep it warm");
  const [count, setCount] = useState(12);
  const [djName, setDjName] = useState(dj);
  const [refresh, setRefresh] = useState(false);
  const [files, setFiles] = useState<Files | null>(null);
  const [rows, setRows] = useState<Record<Stage, RowState>>({
    discover: { kind: "idle" },
    enrich: { kind: "idle" },
    log: { kind: "idle" },
    script: { kind: "idle" },
    voice: { kind: "idle" },
  });
  const [busy, setBusy] = useState(false);

  const status = useCallback(() => {
    void fetchStatus().then((f) => f && setFiles(f));
  }, []);
  useEffect(status, [status]);

  const set = (stage: Stage, s: RowState) => setRows((rs) => ({ ...rs, [stage]: s }));

  /** Run one stage; true when it succeeded. */
  const runOne = async (stage: Stage): Promise<boolean> => {
    set(stage, { kind: "running", since: Date.now() });
    const url = `/program/make/${stage}${stage === "enrich" && refresh ? "?refresh=1" : ""}`;
    const body =
      stage === "discover" ? JSON.stringify({ request, station, dj: djName, startMs, count }) : undefined;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: body ? { "content-type": "application/json" } : {},
        body,
      });
      const j = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        const message = typeof j.error === "string" ? j.error : res.statusText;
        set(stage, { kind: "error", status: res.status, message });
        return false;
      }
      const t = j.timing as { ms: number } | undefined;
      set(stage, {
        kind: "ok",
        ms: t?.ms ?? 0,
        usage: j.usage as Usage | undefined,
        summary: summarize(stage, j),
      });
      return true;
    } catch (e) {
      set(stage, { kind: "error", status: 0, message: e instanceof Error ? e.message : String(e) });
      return false;
    } finally {
      status();
    }
  };

  const run = async (from: Stage, through: Stage) => {
    setBusy(true);
    const a = STAGES.indexOf(from);
    const b = STAGES.indexOf(through);
    for (const stage of STAGES.slice(a, b + 1)) if (!(await runOne(stage))) break;
    setBusy(false);
  };

  const hasInput = (stage: Stage) => {
    const f = INPUT_OF[stage];
    if (!f || !files) return true;
    const v = files[f];
    return typeof v === "number" ? v > 0 : v !== null;
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <label className="flex flex-col gap-1 text-sm text-zinc-400">
          the request
          <textarea
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            rows={3}
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-base text-zinc-100"
          />
        </label>
        <div className="flex flex-wrap items-end gap-4 text-sm text-zinc-400">
          <span>
            {station.calls}, {station.city} · “{station.onAir}”
          </span>
          <label className="flex items-center gap-2">
            on the mic
            <input
              value={djName}
              onChange={(e) => setDjName(e.target.value)}
              className="w-32 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100"
            />
          </label>
          <label className="flex items-center gap-2">
            records
            <input
              type="number"
              min={10}
              max={14}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="w-16 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100"
            />
          </label>
          <span className="flex-1" />
          <button
            type="button"
            disabled={busy || !request.trim() || !djName.trim()}
            onClick={() => void run("discover", "voice")}
            className="rounded-full bg-lamp px-5 py-2 font-medium text-black transition hover:brightness-110 disabled:opacity-40"
          >
            Make
          </button>
        </div>
      </section>

      <ol className="flex flex-col gap-2">
        {STAGES.map((stage) => {
          const row = rows[stage];
          const file = files?.[FILE_OF[stage]] ?? null;
          const has = typeof file === "number" ? file > 0 : file !== null;
          return (
            <li key={stage} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
              <div className="flex flex-wrap items-baseline gap-3">
                <Lamp state={row} has={has} />
                <span className="font-display text-lg uppercase tracking-[0.15em]">{stage}</span>
                <span className="text-sm text-zinc-500">{ABOUT[stage]}</span>
                <span className="flex-1" />
                {stage === "enrich" && (
                  <label className="flex items-center gap-1 text-xs text-zinc-500">
                    <input type="checkbox" checked={refresh} onChange={(e) => setRefresh(e.target.checked)} />
                    refresh cards
                  </label>
                )}
                <button
                  type="button"
                  disabled={busy || !hasInput(stage)}
                  onClick={() => void run(stage, stage)}
                  className="rounded-full border border-zinc-700 px-3 py-1 text-sm transition hover:border-zinc-500 disabled:opacity-40"
                >
                  Run
                </button>
                <button
                  type="button"
                  disabled={busy || !hasInput(stage) || stage === "voice"}
                  onClick={() => void run(stage, "voice")}
                  className="rounded-full border border-zinc-700 px-3 py-1 text-sm transition hover:border-zinc-500 disabled:opacity-40"
                >
                  from here →
                </button>
              </div>
              <div className="mt-1 flex flex-wrap items-baseline gap-3 font-mono text-xs text-zinc-500">
                <Result state={row} />
                <span className="flex-1" />
                {has && (
                  <a href={LINK_OF[stage]} target="_blank" rel="noreferrer" className="hover:text-zinc-300">
                    {typeof file === "number" ? `${file} cards` : `${FILE_OF[stage]} · ${when(file)}`}
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="text-sm text-zinc-500">
        When voice lands,{" "}
        <Link href="/program" className="underline hover:text-zinc-300">
          /program
        </Link>{" "}
        plays it. Files are under <code>apps/web/public/program/make/</code>; edit one and run from that
        stage.
      </p>
    </div>
  );
}

function Lamp({ state, has }: { state: RowState; has: boolean }) {
  const c =
    state.kind === "running"
      ? "bg-amber-400 animate-pulse"
      : state.kind === "error"
        ? "bg-red-500"
        : state.kind === "ok" || has
          ? "bg-lamp"
          : "bg-zinc-700";
  return <span aria-hidden="true" className={`size-2.5 rounded-full ${c}`} />;
}

function Result({ state }: { state: RowState }) {
  switch (state.kind) {
    case "idle":
      return null;
    case "running":
      return <Elapsed since={state.since} />;
    case "error":
      return (
        <span className="text-red-400">
          {state.status ? `${state.status} · ` : ""}
          {state.message}
        </span>
      );
    case "ok":
      return (
        <>
          <span className="text-zinc-300">{state.summary}</span>
          <span>{(state.ms / 1000).toFixed(1)} s</span>
          {state.usage && (
            <span>
              in {state.usage.input} · out {state.usage.output}
              {state.usage.cacheRead ? ` · cached ${state.usage.cacheRead}` : ""}
            </span>
          )}
        </>
      );
  }
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  return <span className="text-amber-300">{((now - since) / 1000).toFixed(0)} s…</span>;
}

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
