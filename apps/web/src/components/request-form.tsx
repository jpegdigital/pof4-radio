"use client";

import { useState, useTransition } from "react";
import { requestSegment } from "@/app/actions";

export function RequestForm({ initial }: { initial: string }) {
  const [prompt, setPrompt] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          try {
            await requestSegment(prompt);
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        });
      }}
    >
      <input
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="late-night soul, something with horns…"
        className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={pending || !prompt.trim()}
        className="rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-black disabled:opacity-40"
      >
        {pending ? "Asking…" : "Ask the DJ"}
      </button>
      {error && <span className="self-center text-sm text-red-400">{error}</span>}
    </form>
  );
}
