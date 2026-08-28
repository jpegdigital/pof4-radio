/**
 * `pnpm enqueue "<what you want to hear>"` — ask the DJ for a segment from the command line
 * (the same thing the page's form does). Prints the segment id; watch the worker plan it.
 */
import { createDb, SEGMENT_QUEUE } from "@radio/db";
import { PgBoss } from "pg-boss";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (run through `op run`, see .env.op)");
const prompt = process.argv.slice(2).join(" ").trim();
if (!prompt) throw new Error('usage: pnpm enqueue "late-night soul with horns"');

const db = createDb(url);
const boss = new PgBoss({ connectionString: url, supervise: false, schedule: false });
await boss.start();
await boss.createQueue(SEGMENT_QUEUE);
const segment = await db.createSegment(prompt);
const jobId = await boss.send(
  SEGMENT_QUEUE,
  { segmentId: segment.id },
  { retryLimit: 0, expireInSeconds: 300 },
);
console.log(`segment ${segment.id} queued (job ${jobId})`);
await boss.stop({ graceful: false });
await db.close();
