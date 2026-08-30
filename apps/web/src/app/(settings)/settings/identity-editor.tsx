"use client";

import type { Identity } from "@radio/dj";
import { useActionState, useState } from "react";
import { type SaveState, saveIdentity } from "./actions";

/**
 * The station's identity: call letters, city, and the name as it is said on air. Three fields,
 * one row (`settings.station.identity`), copied onto every station at creation — a kept station
 * keeps the call letters it opened with.
 */
export function IdentityEditor({ value, updatedAt }: { value: Identity | null; updatedAt: string | null }) {
  const [form, setForm] = useState<Identity>(value ?? { calls: "", city: "", onAir: "" });
  const [save, saveAction, saving] = useActionState<SaveState, FormData>(saveIdentity, {});
  const dirty = JSON.stringify(form) !== JSON.stringify(value ?? { calls: "", city: "", onAir: "" });
  const field = (name: keyof Identity, label: string, hint: string) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-display text-xs uppercase tracking-[0.15em] text-zinc-500">{label}</span>
      <input
        name={name}
        value={form[name]}
        onChange={(e) => setForm((f) => ({ ...f, [name]: e.target.value }))}
        placeholder={hint}
        className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 font-mono text-[13px] text-zinc-100 focus:border-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-lamp/60"
      />
    </label>
  );
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-display text-sm uppercase tracking-[0.2em] text-zinc-500">
            {updatedAt === null ? "No row in settings yet" : `Edited ${when(updatedAt)}`}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Identity</h1>
          <p className="mt-1 max-w-prose text-sm text-zinc-400">
            Who the station is. The legal ID at the top of the hour is built from it; every new station copies
            it.
          </p>
        </div>
        <p className="font-mono text-xs text-zinc-600">station.identity</p>
      </div>
      <form action={saveAction} className="flex max-w-md flex-col gap-4">
        {field("calls", "Call letters", "WFAI")}
        {field("city", "City", "Dallas")}
        {field("onAir", "Said on air as", "56.6, Claude Radio")}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={!dirty || saving}
            className="rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-black transition disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          {save.error && <span className="text-sm text-red-400">{save.error}</span>}
          {!dirty && save.savedAt && !save.error && (
            <span className="text-sm text-zinc-500">Saved — applies to the next station opened.</span>
          )}
        </div>
      </form>
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
