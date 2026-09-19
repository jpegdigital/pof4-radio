/**
 * Manual billed integration check against a running local app. Creates one labeled session,
 * searches Qobuz, writes/voices one non-break slot, verifies Jev's receipt and retry identity.
 * op run --env-file=.env.op -- node apps/web/scripts/pick-slot-smoke.mts http://127.0.0.1:3011
 */
import assert from "node:assert/strict";
import pg from "pg";
import { z } from "zod";
import type { SlotDoc } from "../src/app/api/sessions/doc.ts";
import type { PickReceipt } from "../src/app/api/sessions/pick.ts";
import { qobuz } from "../src/app/api/sessions/qobuz.ts";

const origin = process.argv[2];
if (!origin) throw new Error("Supply the running local app origin");
const e = process.env;
if (!e.DATABASE_URL || !e.QOBUZ_TOKEN) throw new Error("DATABASE_URL and QOBUZ_TOKEN required");
const db = new pg.Pool({ connectionString: e.DATABASE_URL });
const post = async (path: string, body: unknown): Promise<unknown> => {
  const res = await fetch(new URL(path, origin), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}: ${await res.text()}`);
  return res.json();
};
try {
  const { rows } = await db.query<{ value: string }>("select value from settings where key = 'voices'");
  const voices = z.array(z.object({ id: z.string() })).parse(JSON.parse(rows[0]?.value ?? "[]"));
  assert(voices[0], "Need a configured voice");
  const q = qobuz({ token: e.QOBUZ_TOKEN, appId: e.QOBUZ_APP_ID, secret: e.QOBUZ_SECRET });
  const hits = await q.search("Fleetwood Mac Dreams", 3);
  assert(hits.length, "Need real Qobuz recordings");
  const { sessionId } = z.object({ sessionId: z.uuid() }).parse(
    await post("/api/sessions", {
      voiceId: voices[0].id,
      prompt: `[Jev smoke ${new Date().toISOString()}] Play Dreams by Fleetwood Mac, the original studio recording.`,
    }),
  );
  console.log(`Smoke session: ${sessionId}`);
  // A non-break slot isolates the changed selection/write path from the news editor.
  await db.query(
    "insert into session_slot (session_id, seq, title, artist, why, hits) values ($1, 2, $2, $3, $4, $5)",
    [sessionId, "Dreams", "Fleetwood Mac", "Isolated Jev integration smoke", JSON.stringify(hits)],
  );
  const path = `/api/sessions/${sessionId}/slots/2`;
  const slot = (await post(path, { clockMs: 20 * 3_600_000 })) as SlotDoc;
  assert(slot.voiced, "Slot must finish voicing");
  const { rows: saved } = await db.query<{ qobuz_id: string; selection: PickReceipt }>(
    "select qobuz_id, selection from session_slot where session_id = $1 and seq = 2",
    [sessionId],
  );
  const receipt = saved[0].selection;
  assert(receipt, "Jev decision receipt must be persisted");
  assert.equal(slot.pick?.id, receipt.pick);
  assert.equal(saved[0].qobuz_id, receipt.response.answers.pick.choice);
  assert.equal(receipt.request.state.hits.length, hits.length);
  const retry = (await post(path, { clockMs: 20 * 3_600_000 })) as SlotDoc;
  assert.equal(retry.pick?.id, slot.pick?.id);
  assert.equal(retry.clipKey, slot.clipKey);
  const { rows: after } = await db.query<{ selection: PickReceipt }>(
    "select selection from session_slot where session_id = $1 and seq = 2",
    [sessionId],
  );
  assert.deepEqual(after[0].selection, receipt, "Retry must not run selection again");
  console.log(
    JSON.stringify(
      {
        sessionId,
        pick: slot.pick,
        kind: slot.kind,
        words: slot.words,
        model: receipt.response.model,
        jevMs: receipt.elapsedMs,
        voiced: slot.voiced,
        receiptSaved: true,
        retryUnchanged: true,
      },
      null,
      2,
    ),
  );
} finally {
  await db.end();
}
