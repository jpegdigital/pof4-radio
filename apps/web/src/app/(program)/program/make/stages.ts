import type { Usage } from "./ask";
import { discover } from "./discover";
import { enrich } from "./enrich";
import { MakeError } from "./files";
import { log } from "./log";
import { script } from "./script";
import { isStage, type Stage, STAGES } from "./shapes";
import { voice } from "./voice";

/**
 * The pipeline's dispatch. Each stage reads the previous stage's file(s), writes its own, and
 * returns what it wrote; the page runs them in order for "Make", or one at a time for a re-run.
 */
export { isStage, type Stage, STAGES };

export interface StageContext {
  body?: unknown;
  refresh: boolean;
}

export interface StageResult {
  result: unknown;
  usage?: Usage;
  ms: number;
}

export async function runStage(stage: Stage, ctx: StageContext): Promise<StageResult> {
  const t0 = Date.now();
  const done = (result: unknown, usage?: Usage): StageResult => ({ result, usage, ms: Date.now() - t0 });
  switch (stage) {
    case "discover": {
      if (ctx.body === undefined) throw new MakeError(400, "discover needs a request body");
      const r = await discover(ctx.body);
      return done(r.picks, r.usage);
    }
    case "enrich": {
      const r = await enrich({ refresh: ctx.refresh });
      return done({ cards: r.cards, dropped: r.dropped, reused: r.reused, failed: r.failed }, r.usage);
    }
    case "log": {
      const r = await log();
      return done({ ...r.log, warnings: r.warnings, skipped: r.skipped }, r.usage);
    }
    case "script": {
      const r = await script();
      return done({ ...r.script, skipped: r.skipped }, r.usage);
    }
    case "voice": {
      const r = await voice();
      return done({ ...r.program, failed: r.failed });
    }
  }
}
