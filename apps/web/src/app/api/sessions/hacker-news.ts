import { z } from "zod";
import { fingerprint, plain, type Article } from "./headlines.ts";

const API = "https://hacker-news.firebaseio.com/v0";
const TOP_STORIES = 30;
const CONCURRENCY = 5;
const COMMENTS = 2;
const TIMEOUT_MS = 8_000;
const MAX_BYTES = 200_000;
const Item = z.object({
  id: z.number().int(),
  type: z.string(),
  title: z.string().optional(),
  by: z.string().optional(),
  text: z.string().optional(),
  time: z.number(),
  url: z.string().optional(),
  score: z.number().optional(),
  descendants: z.number().optional(),
  kids: z.array(z.number().int().positive()).optional(),
  parent: z.number().optional(),
  dead: z.boolean().optional(),
  deleted: z.boolean().optional(),
});

/** HN is evidence of a submission/discussion, never independent proof of a linked claim. */
export async function readHackerNews({
  now,
  signal,
  fetchFn = fetch,
}: {
  now: number;
  signal: AbortSignal;
  fetchFn?: typeof fetch;
}): Promise<{ articles: Article[]; errors: string[]; raw: Record<string, unknown> }> {
  const errors: string[] = [];
  const rawData: Record<string, unknown> = {};
  const json = async (path: string): Promise<unknown> => {
    const res = await fetchFn(`${API}/${path}.json`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
      redirect: "error",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`HN ${path} HTTP ${res.status}`);
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error(`HN ${path}: empty body`);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) throw new Error(`HN ${path}: response too large`);
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    rawData[path] = data;
    return data;
  };
  const ids = z
    .array(z.number().int().positive())
    .parse(await json("topstories"))
    .slice(0, TOP_STORIES);
  const articles: Article[] = [];
  for (let offset = 0; offset < ids.length; offset += CONCURRENCY) {
    const batch = await Promise.all(
      ids.slice(offset, offset + CONCURRENCY).map(async (id, index): Promise<Article | null> => {
        try {
          const raw = await json(`item/${id}`);
          if (
            !raw ||
            (typeof raw === "object" &&
              (("dead" in raw && raw.dead === true) || ("deleted" in raw && raw.deleted === true)))
          )
            return null;
          const item = Item.parse(raw);
          if (item.id !== id || item.type !== "story" || !item.title) return null;
          const rank = offset + index + 1;
          const url = `https://news.ycombinator.com/item?id=${id}`;
          const title = plain(item.title);
          const comments: { author: string; text: string; url: string }[] = [];
          for (const child of (item.kids ?? []).slice(0, COMMENTS)) {
            try {
              const comment = Item.safeParse(await json(`item/${child}`));
              if (
                comment.success &&
                comment.data.type === "comment" &&
                comment.data.parent === id &&
                !comment.data.dead &&
                !comment.data.deleted &&
                comment.data.text
              )
                comments.push({
                  author: plain(comment.data.by),
                  text: plain(comment.data.text).slice(0, 600),
                  url: "https://news.ycombinator.com/item?id=" + child,
                });
            } catch (error) {
              errors.push(`comment ${child}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
          const evidence = plain(item.text).slice(0, 1800);
          return {
            id: fingerprint(url),
            sourceId: "hacker-news",
            source: "Hacker News",
            title,
            url,
            scope: "tech",
            at: new Date(item.time * 1000).toISOString(),
            fetchedAt: new Date(now).toISOString(),
            evidence,
            revision: fingerprint(title + evidence),
            community: {
              author: plain(item.by),
              discussion: comments,
              rank,
              score: item.score ?? 0,
              comments: item.descendants ?? 0,
              url,
              ...(item.url ? { linkedUrl: item.url } : {}),
            },
          };
        } catch (error) {
          errors.push(`item ${id}: ${error instanceof Error ? error.message : String(error)}`);
          return null;
        }
      }),
    );
    articles.push(...batch.filter((a): a is Article => a !== null));
    signal.throwIfAborted();
  }
  if (ids.length && !articles.length && errors.length) throw new Error(`HN items unavailable: ${errors[0]}`);
  return { articles, errors, raw: rawData };
}
