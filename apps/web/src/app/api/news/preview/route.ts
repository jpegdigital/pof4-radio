import { z } from "zod";
import { pool } from "@/lib/db";
import { env } from "@/lib/env";
import { loadNews } from "@/lib/settings";
import { readPreparedNews } from "@/lib/prepared";
import { chooseHeadlines } from "../../sessions/headline-choice";

const Preview = z.object({ prompt: z.string().max(2000).default("An evening in Dallas with good music") });
/** Preview uses exactly the session selector and saved editions. No fetching or second writer. */
export async function POST(req: Request) {
  const parsed = Preview.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid preview request" }, { status: 400 });
  try {
    const entry = await readPreparedNews(pool(), await loadNews());
    const decision = await chooseHeadlines(
      { prompt: parsed.data.prompt, headlines: entry?.data ?? [], history: [], now: Date.now() },
      { apiKey: env().TYPESAFE_API_KEY, model: env().TYPESAFE_MODEL },
    );
    return Response.json(
      {
        entryId: entry?.id ?? null,
        preparedAt: entry?.preparedAt ?? null,
        options: entry?.data ?? [],
        selected: decision.selected,
        decision,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
