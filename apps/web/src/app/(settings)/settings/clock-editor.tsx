"use client";

import { type Clock, CLOCK_KEY } from "@/lib/clock";
import { useActionState, useState } from "react";
import { type SaveState, saveClock } from "./actions";

/**
 * The clock: break every, fill, low water. Three integers, one row (`settings.clock`), read by
 * every fill and slot request — a change reaches the next slot produced.
 */
type Form = Record<keyof Clock, string>;
const EMPTY: Form = { breakEvery: "", fill: "", lowWater: "" };
const formOf = (c: Clock | null): Form =>
  c ? { breakEvery: String(c.breakEvery), fill: String(c.fill), lowWater: String(c.lowWater) } : EMPTY;

export function ClockEditor({ value, updatedAt }: { value: Clock | null; updatedAt: string | null }) {
  const [form, setForm] = useState<Form>(formOf(value));
  const [save, saveAction, saving] = useActionState<SaveState, FormData>(saveClock, {});
  const dirty = JSON.stringify(form) !== JSON.stringify(formOf(value));
  const field = (name: keyof Clock, label: string, hint: string) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-display text-xs uppercase tracking-[0.15em] text-zinc-500">{label}</span>
      <input
        name={name}
        type="number"
        inputMode="numeric"
        min={1}
        step={1}
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
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Clock</h1>
          <p className="mt-1 max-w-prose text-sm text-zinc-400">
            How the show is paced. A break at slot 1 and every so many after; how many slots a fill proposes;
            how few unwritten slots are left before the next fill. Without this row nothing is produced.
          </p>
        </div>
        <p className="font-mono text-xs text-zinc-600">{CLOCK_KEY}</p>
      </div>
      <form action={saveAction} className="flex max-w-md flex-col gap-4">
        {field("breakEvery", "Break every", "5")}
        {field("fill", "Fill", "6")}
        {field("lowWater", "Low water", "2")}
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
            <span className="text-sm text-zinc-500">Saved — applies to the next slot produced.</span>
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
