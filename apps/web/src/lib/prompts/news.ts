import { template } from "./template.ts";
import { z } from "zod";
import type { Article } from "../../app/api/sessions/headlines.ts";
import { ChatPrompt } from "./contract.ts";

const renderPrepare = template("news-prepare", z.strictObject({}));
const renderReview = template("news-review", z.strictObject({}));

const Batch = z.object({
  options: z.array(
    z.object({
      articleId: z.string(),
      topic: z.string(),
      expiresAt: z.string(),
      facts: z.array(z.object({ text: z.string(), quote: z.string() })),
    }),
  ),
});
const Reviews = z.object({
  reviews: z.array(z.object({ articleId: z.string(), approved: z.boolean(), reason: z.string() })),
});
interface NewsInput {
  now: number;
  articles: Article[];
}

export const newsPreparePrompt = {
  output: Batch,
  render(input: NewsInput & { maximumExpiry: number; timeZone: string }): ChatPrompt {
    return ChatPrompt.parse({
      system: renderPrepare({}),
      brief: JSON.stringify({
        now: new Date(input.now).toISOString(),
        maximumExpiry: new Date(input.maximumExpiry).toISOString(),
        place: "Dallas, TX",
        timeZone: input.timeZone,
        articles: input.articles,
      }),
    });
  },
};

export const newsReviewPrompt = {
  output: Reviews,
  render(input: NewsInput & { options: z.infer<typeof Batch>["options"] }): ChatPrompt {
    return ChatPrompt.parse({
      system: renderReview({}),
      brief: JSON.stringify({
        now: new Date(input.now).toISOString(),
        articles: input.articles,
        options: input.options,
      }),
    });
  },
};
