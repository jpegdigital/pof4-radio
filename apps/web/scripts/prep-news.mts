import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { prompts } from "../src/lib/prompts/index.ts";
import { eligibleArticles, readHeadlines, type Article } from "../src/app/api/sessions/headlines.ts";
import type { NewsConfig } from "../src/lib/news.ts";
import { NEWS_VALID_MS, PREP_AIR_MARGIN_MS, type PreparedHeadline } from "../src/lib/prepared.ts";

type Option = z.infer<typeof prompts.newsPrepare.output>["options"][number];
type Review = z.infer<typeof prompts.newsReview.output>["reviews"][number];

export function checkedOptions(
  options: Option[],
  articles: Article[],
  reviews: Review[],
  now: number,
): PreparedHeadline[] {
  const seen = new Set<string>();
  return options.flatMap((o): PreparedHeadline[] => {
    const a = articles.find((a) => a.id === o.articleId);
    const checks = reviews.filter((r) => r.articleId === o.articleId);
    const expires = Date.parse(o.expiresAt);
    if (
      !a ||
      seen.has(a.id) ||
      checks.length !== 1 ||
      !checks[0].approved ||
      !o.topic.trim() ||
      !o.facts.length ||
      o.facts.length > 6 ||
      o.facts.some((f) => !f.text.trim() || f.quote.length < 12 || !a.evidence.includes(f.quote)) ||
      !Number.isFinite(expires) ||
      expires <= now + PREP_AIR_MARGIN_MS ||
      expires > now + NEWS_VALID_MS
    )
      return [];
    // Never extend the publisher-age window just because this edition was fetched recently.
    const expiry = Math.min(expires, Date.parse(a.at) + (a.scope === "culture" ? 7 : 1) * 86_400_000);
    if (expiry <= now + PREP_AIR_MARGIN_MS) return [];
    seen.add(a.id);
    return [
      {
        articleId: a.id,
        storyId: `story-${a.id}`,
        revision: a.revision,
        title: a.title,
        topic: o.topic,
        sourceId: a.sourceId,
        source: a.source,
        url: a.url,
        scope: a.scope,
        publishedAt: a.at,
        fetchedAt: a.fetchedAt,
        checkedAt: new Date(now).toISOString(),
        expiresAt: new Date(expiry).toISOString(),
        evidence: a.evidence,
        facts: o.facts,
      },
    ];
  });
}

/** Batch research only. No listener-specific choice, spoken copy, Jev, or TTS. */
export async function prepareNews(config: NewsConfig, apiKey: string, model: string, signal: AbortSignal) {
  const snapshot = await readHeadlines(config, { budgetMs: 60_000, timeoutMs: 15_000, signal });
  const healthy = new Set(snapshot.sources.filter((s) => s.status === "fresh").map((s) => s.id));
  const articles = eligibleArticles(snapshot.articles, Date.now())
    .filter((a) => healthy.has(a.sourceId) && a.evidence.length >= 60)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  // Give local news and cultural discovery their own space in the menu.
  const menu = ["local", "culture", "nation", "world"].flatMap((scope) =>
    articles.filter((a) => a.scope === scope).slice(0, 6),
  );
  if (!menu.length) throw new Error("No fresh publisher evidence; previous news editions retained");
  const client = new Anthropic({ apiKey, maxRetries: 0 });
  const now = Date.now();
  const preparation = prompts.newsPrepare.render({
    now,
    maximumExpiry: now + NEWS_VALID_MS,
    timeZone: config.timeZone,
    articles: menu,
  });
  const prepared = await client.messages.parse(
    {
      model,
      max_tokens: 6500,
      system: preparation.system,
      messages: [{ role: "user", content: preparation.brief }],
      output_config: { format: zodOutputFormat(prompts.newsPrepare.output) },
    },
    { signal },
  );
  const draft = prepared.parsed_output;
  if (!draft || draft.options.length > 12) throw new Error("News preparation returned an invalid batch");
  let reviews: Review[] = [];
  let reviewUsage: unknown = null;
  if (draft.options.length) {
    const review = prompts.newsReview.render({ now: Date.now(), articles: menu, options: draft.options });
    const checked = await client.messages.parse(
      {
        model,
        max_tokens: 3500,
        system: review.system,
        messages: [{ role: "user", content: review.brief }],
        output_config: { format: zodOutputFormat(prompts.newsReview.output) },
      },
      { signal },
    );
    if (!checked.parsed_output) throw new Error("News evidence review returned no result");
    reviews = checked.parsed_output.reviews;
    reviewUsage = checked.usage;
  }
  const options = checkedOptions(draft.options, menu, reviews, Date.now());
  return {
    snapshot,
    options,
    audit: { version: "scheduled-news-1", model, draft, reviews, usage: [prepared.usage, reviewUsage] },
  };
}
