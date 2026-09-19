"use client";

import { useActionState, useState } from "react";

import { NEWS_SOURCES, type NewsConfig } from "@/lib/news";

import type { PreparedHeadline } from "@/lib/prepared";

import { saveNews, type SaveState } from "./actions";

interface Preview {
  preparedAt: string | null;
  options: PreparedHeadline[];
  selected: PreparedHeadline[];
  error?: string;
}

export function NewsEditor({ value }: { value: NewsConfig }) {
  const [form, setForm] = useState(value);

  const [save, action, saving] = useActionState<SaveState, FormData>(saveNews, {});

  const [busy, setBusy] = useState(false);

  const [error, setError] = useState("");

  const [preview, setPreview] = useState<Preview | null>(null);

  const [request, setRequest] = useState("An evening in Dallas with good music");

  const dirty = JSON.stringify(form) !== JSON.stringify(value);

  const inputClass =
    "rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 focus-visible:outline-2 focus-visible:outline-lamp";

  const trial = async () => {
    setBusy(true);
    setError("");

    try {
      const res = await fetch("/api/news/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: request }),
        signal: AbortSignal.timeout(20_000),
      });

      const body = (await res.json()) as Preview;

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
          Jev chooses at most one prepared story that fit your show. Weak matches and stories already selected
          in the show are omitted.
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
        <p className="text-sm text-zinc-400">
          Dallas, TX · America/Chicago. Headlines refresh every three hours; weather every 30 minutes.
        </p>
        <fieldset>
          <legend className="mb-2 text-sm text-zinc-400">Sources</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {NEWS_SOURCES.filter((s) => !s.discoveryOnly).map((source) => (
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
              </label>
            ))}
          </div>
        </fieldset>
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
          Preview Jev’s choices from saved evidence without recording a voice or changing a show.
        </p>
        <label className="mt-3 flex flex-col gap-1 text-sm">
          Listener request
          <input
            className={inputClass}
            maxLength={2000}
            value={request}
            onChange={(e) => setRequest(e.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={busy || dirty}
          onClick={() => void trial()}
          className="mt-3 min-h-11 rounded border border-zinc-600 px-4 text-sm disabled:opacity-40"
        >
          {busy ? "Jev is choosing…" : "Preview prepared headlines"}
        </button>
        {dirty && <p className="mt-2 text-xs text-amber-200">Save settings before previewing.</p>}
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-300">
            {error}
          </p>
        )}
        {preview && (
          <div className="mt-5 space-y-4">
            <p className="text-lg">
              {preview.selected.length
                ? `Jev selected ${preview.selected.length} stories`
                : "No suitable prepared stories"}
            </p>
            <p className="text-xs text-zinc-500">
              {preview.preparedAt
                ? `Prepared ${new Date(preview.preparedAt).toLocaleString()} · ${preview.options.length} options`
                : "No usable edition. The next scheduled run will refresh the options."}
            </p>
            {preview.options.map((article) => (
              <details key={article.articleId} className="border-t border-zinc-800 py-3">
                <summary className="cursor-pointer text-sm">
                  {preview.selected.some((h) => h.articleId === article.articleId) ? "Selected · " : ""}
                  {article.source} · {article.title}
                </summary>
                <p className="mt-2 text-xs text-zinc-500">
                  Published {new Date(article.publishedAt).toLocaleString()}
                </p>
                <p className="mt-2 text-sm text-zinc-400">{article.facts.map((f) => f.text).join(" ")}</p>
                <a
                  href={article.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-sm text-lamp underline"
                >
                  Read the source
                </a>
              </details>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
