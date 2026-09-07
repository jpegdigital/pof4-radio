"use client";

import { useActionState, useState } from "react";
import { NEWS_SOURCES, type NewsConfig, type NewsReceipt } from "@/lib/news";
import type { HeadlineSnapshot } from "../../api/sessions/headlines";
import { saveNews, type SaveState } from "./actions";

export function NewsEditor({ value }: { value: NewsConfig }) {
  const [form, setForm] = useState(value);
  const [save, action, saving] = useActionState<SaveState, FormData>(saveNews, {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ snapshot: HeadlineSnapshot; receipt: NewsReceipt } | null>(null);
  const [request, setRequest] = useState("An evening in Dallas with good music");
  const dirty = JSON.stringify(form) !== JSON.stringify(value);
  const inputClass =
    "rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 focus-visible:outline-2 focus-visible:outline-lamp";
  const trial = async (same: boolean) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/news/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          refresh: !same,
          snapshotId: same ? preview?.snapshot.id : undefined,
          prompt: request,
        }),
        signal: AbortSignal.timeout((form.editTimeoutSeconds + 15) * 1000),
      });
      const body = (await res.json()) as { snapshot: HeadlineSnapshot; receipt: NewsReceipt; error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setPreview(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold">Headlines</h1>
        <p className="mt-2 max-w-prose text-sm text-zinc-400">
          One worthwhile, sourced story at a break. If the evidence is weak, the music continues. Sources
          refresh only while a show or preview needs them.
        </p>
      </header>
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="news" value={JSON.stringify(form)} />
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          />
          Include news in new breaks
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          {(["city", "region", "timeZone"] as const).map((key) => (
            <label key={key} className="flex flex-col gap-1 text-sm">
              <span>{key === "timeZone" ? "Timezone" : key === "city" ? "City" : "State / region"}</span>
              <input
                className={inputClass}
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            </label>
          ))}
        </div>
        <fieldset>
          <legend className="mb-2 text-sm text-zinc-400">
            Sources · Dallas-specific feeds are used only for Dallas, TX
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {NEWS_SOURCES.map((source) => (
              <label key={source.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.sources.includes(source.id)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      sources: e.target.checked
                        ? [...form.sources, source.id]
                        : form.sources.filter((s) => s !== source.id),
                    })
                  }
                />
                {source.name} · {source.scope}
                {source.discoveryOnly ? " (discovery)" : ""}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["refreshMinutes", "News refresh (minutes)"],
              ["cultureRefreshMinutes", "Culture refresh (minutes)"],
              ["memoryHours", "Story memory (hours)"],
              ["maxWords", "News word budget"],
              ["editTimeoutSeconds", "Editing time budget (seconds)"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex flex-col gap-1 text-sm">
              {label}
              <input
                type="number"
                min={1}
                className={inputClass}
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
              />
            </label>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="min-h-11 rounded bg-zinc-100 px-4 text-sm font-medium text-black disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save news settings"}
          </button>
          {save.error && (
            <p role="alert" className="text-sm text-red-300">
              {save.error}
            </p>
          )}
          {save.savedAt && !dirty && <p className="text-sm text-zinc-400">Saved.</p>}
        </div>
      </form>
      <section className="border-t border-zinc-800 pt-6">
        <h2 className="text-lg font-medium">Try the news desk</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Uses saved settings. Compare the choice and evidence without recording a voice or changing a show.
        </p>
        <label className="mt-3 flex flex-col gap-1 text-sm">
          Listener request
          <input
            className={inputClass}
            maxLength={500}
            value={request}
            onChange={(e) => setRequest(e.target.value)}
          />
        </label>
        <div className="mt-3 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy || dirty}
            onClick={() => void trial(false)}
            className="min-h-11 rounded border border-zinc-600 px-4 text-sm disabled:opacity-40"
          >
            {busy ? "Checking sources…" : "Pull fresh and preview"}
          </button>
          {preview && (
            <button
              type="button"
              disabled={busy || dirty}
              onClick={() => void trial(true)}
              className="min-h-11 px-3 text-sm underline disabled:opacity-40"
            >
              Compare using the same evidence
            </button>
          )}
        </div>
        {dirty && <p className="mt-2 text-xs text-amber-200">Save settings before previewing.</p>}
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-300">
            {error}
          </p>
        )}
        {preview && (
          <div className="mt-5 space-y-4">
            <div className="rounded-lg border border-zinc-700 p-4">
              <p className="text-lg">{preview.receipt.words ?? "No news selected"}</p>
              <p className="mt-2 text-sm text-zinc-400">{preview.receipt.reason}</p>
            </div>
            <p className="text-xs text-zinc-500">
              Evidence as of {new Date(preview.snapshot.at).toLocaleString()} ·{" "}
              {preview.snapshot.articles.length} articles
            </p>
            {preview.snapshot.sources.map((source) => (
              <p key={source.id} className="text-xs text-zinc-400">
                {source.id}: {source.status}, {source.count} items{source.error ? ` · ${source.error}` : ""}
              </p>
            ))}
            {preview.snapshot.articles.map((article) => (
              <details key={`${article.sourceId}:${article.id}`} className="border-t border-zinc-800 py-3">
                <summary className="cursor-pointer text-sm">
                  {article.source} · {article.title}
                </summary>
                <p className="mt-2 text-xs text-zinc-500">
                  {article.at ? new Date(article.at).toLocaleString() : "Unknown date"}
                </p>
                <p className="mt-2 text-sm text-zinc-400">
                  {article.evidence || "Discovery only: no publisher excerpt to support spoken copy."}
                </p>
                {article.url && (
                  <a
                    href={article.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-block text-sm text-lamp underline"
                  >
                    Read the source
                  </a>
                )}
              </details>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
