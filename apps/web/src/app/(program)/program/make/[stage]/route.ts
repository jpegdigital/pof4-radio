import { listCards, MakeError, stat } from "../files";
import { isStage, runStage } from "../stages";

/**
 * POST /program/make/{discover|enrich|log|script|voice}: run one stage. GET /program/make/status:
 * which stage files exist. Dev only — the stages write into the app's own public/ tree, so in
 * production these answer 404 and nothing here can run on Railway.
 */
export const dynamic = "force-dynamic";

const production = () => process.env.NODE_ENV === "production";

type Params = { params: Promise<{ stage: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { stage } = await params;
  if (production() || stage !== "status") return new Response(null, { status: 404 });
  const [request, picks, cards, log, script, program] = await Promise.all([
    stat("request.json"),
    stat("picks.json"),
    listCards(),
    stat("log.json"),
    stat("script.json"),
    stat("program.json"),
  ]);
  return Response.json({
    files: {
      "request.json": request,
      "picks.json": picks,
      cards: cards.length,
      "log.json": log,
      "script.json": script,
      "program.json": program,
    },
  });
}

export async function POST(req: Request, { params }: Params) {
  const { stage } = await params;
  if (production() || !isStage(stage)) return new Response(null, { status: 404 });
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  const text = await req.text();
  let body: unknown;
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      return Response.json({ error: "body is not JSON" }, { status: 400 });
    }
  }
  try {
    const { result, usage, ms } = await runStage(stage, { body, refresh });
    return Response.json({ ...(result as object), timing: { ms }, ...(usage ? { usage } : {}) });
  } catch (err) {
    const status = err instanceof MakeError ? err.status : 502;
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[program make] ${stage} failed (${status}): ${message}`);
    return Response.json({ error: message }, { status });
  }
}
