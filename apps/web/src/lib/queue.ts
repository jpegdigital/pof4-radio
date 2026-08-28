import { SEGMENT_QUEUE } from "@radio/db";
import { PgBoss } from "pg-boss";
import { env } from "./env";

/**
 * The web app only *sends* segment jobs. pg-boss runs send-only here (no maintenance,
 * no scheduling — the worker owns that).
 */
const g = globalThis as unknown as { __boss?: Promise<PgBoss> };

async function boss(): Promise<PgBoss> {
  g.__boss ??= (async () => {
    const b = new PgBoss({ connectionString: env().DATABASE_URL, supervise: false, schedule: false });
    b.on("error", (err) => console.error("[pg-boss]", err));
    await b.start();
    await b.createQueue(SEGMENT_QUEUE); // idempotent; lets web enqueue before the worker has booted
    return b;
  })();
  return g.__boss;
}

/** One job = one DJ run (a handful of Claude calls). retryLimit 0: a failure is terminal. */
export async function enqueueSegment(segmentId: string): Promise<string | null> {
  const b = await boss();
  return b.send(SEGMENT_QUEUE, { segmentId }, { retryLimit: 0, expireInSeconds: 5 * 60 });
}
