import { readHeadlines } from "../src/app/api/sessions/headlines.ts";
import type { NewsConfig } from "../src/lib/news.ts";
import { RawHeadline } from "../src/lib/prepared.ts";

/** Collect and normalize source data. No model client, prompts, or generated editorial material. */
export async function prepareNews(config: NewsConfig, signal: AbortSignal, fetchFn: typeof fetch = fetch) {
  const snapshot = await readHeadlines(config, { budgetMs: 60_000, timeoutMs: 15_000, signal, fetchFn });
  signal.throwIfAborted();
  if (!snapshot.sources.some((s) => s.status === "fresh"))
    throw new Error("No news sources available; previous editions retained");
  const seen = new Set<string>();
  const articles = snapshot.articles.flatMap((a) => {
    if (!a.url || seen.has(a.id)) return [];
    seen.add(a.id);
    return [
      RawHeadline.parse({
        articleId: a.id,
        storyId: `story-${a.id}`,
        revision: a.revision,
        title: a.title,
        sourceId: a.sourceId,
        source: a.source,
        url: a.url,
        scope: a.scope,
        publishedAt: a.at || null,
        fetchedAt: a.fetchedAt,
        excerpt: a.evidence,
        ...(a.community ? { community: a.community } : {}),
      }),
    ];
  });
  return { snapshot, articles };
}
