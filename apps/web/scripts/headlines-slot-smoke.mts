/**
 * Manual billed live verification, with pnpm dev running. Creates ONE labeled smoke session,
 * reuses an existing catalog hit, voices a break, checks receipts and expires only that test slot.
 * op run --env-file=.env.op -- node apps/web/scripts/headlines-slot-smoke.mts
 */
import assert from "node:assert/strict";
import { request } from "node:https";
import { createHash } from "node:crypto";
import pg from "pg";
import type { NewsReceipt } from "../src/lib/news.ts";
import type { Hit } from "../src/app/api/sessions/doc.ts";

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
// Only this known local dev host uses its existing self-signed development certificate.
const origin = "https://dev.radio.pof4.com:3000";
const call = (path: string, body?: unknown): Promise<{ status: number; bytes: Buffer }> =>
  new Promise((resolve, reject) => {
    const req = request(
      new URL(path, origin),
      {
        method: body ? "POST" : "GET",
        rejectUnauthorized: false,
        headers: body ? { "Content-Type": "application/json" } : {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, bytes: Buffer.concat(chunks) }));
        res.on("error", reject);
      },
    );
    req.setTimeout(180_000, () => req.destroy(new Error("smoke request timed out")));
    req.on("error", reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
try {
  const { rows: voices } = await db.query<{ value: string }>(
    "select value from settings where key = 'voices'",
  );
  const roster = JSON.parse(voices[0]?.value ?? "[]") as { id: string }[];
  assert(roster[0], "Need an existing voice");
  const { rows: hits } = await db.query<{ title: string; artist: string; hits: Hit[] }>(
    "select title, artist, hits from session_slot where qobuz_id is not null and jsonb_array_length(hits) > 0 order by created_at desc limit 1",
  );
  assert(hits[0], "Need an existing catalog hit");
  const created = await call("/api/sessions", {
    voiceId: roster[0].id,
    prompt: `[Headline smoke ${new Date().toISOString()}] Sunday evening in Dallas, soulful and curious.`,
  });
  assert.equal(created.status, 200, created.bytes.toString());
  const { sessionId } = JSON.parse(created.bytes.toString()) as { sessionId: string };
  console.log(`Smoke session: ${sessionId}`);
  await db.query(
    "insert into session_slot (session_id, seq, title, artist, why, hits) values ($1, 1, $2, $3, $4, $5)",
    [
      sessionId,
      hits[0].title,
      hits[0].artist,
      "Isolated headline integration smoke; reuse a catalog hit",
      JSON.stringify(hits[0].hits),
    ],
  );
  const slotPath = `/api/sessions/${sessionId}/slots/1`;
  const result = await call(slotPath, { clockMs: 20 * 3_600_000 });
  assert.equal(result.status, 200, result.bytes.toString());
  const slot = JSON.parse(result.bytes.toString()) as {
    clipKey: string;
    words: string;
    legalId: string;
    news: NewsReceipt;
    voiced: boolean;
  };
  assert(slot.voiced);
  assert(slot.news, "Break must have a news decision receipt");
  console.log(
    JSON.stringify(
      {
        voiced: slot.voiced,
        selected: Boolean(slot.news.words),
        reason: slot.news.reason,
        sources: slot.news.sources,
        hasNewsFreeTake: Boolean(slot.news.fallbackClipKey),
      },
      null,
      2,
    ),
  );
  const retry = await call(slotPath, { clockMs: 20 * 3_600_000 });
  assert.equal(retry.status, 200);
  assert.equal((JSON.parse(retry.bytes.toString()) as { clipKey: string }).clipKey, slot.clipKey);
  const { rows: receipts } = await db.query<{ count: string }>(
    "select count(*) from headline_snapshot where id = $1",
    [slot.news.snapshotId],
  );
  assert.equal(receipts[0].count, "1");
  if (slot.news.words) {
    assert(slot.news.fallbackClipKey, "Selected news needs a prepared safe take");
    const acknowledgment = {
      clipKey: slot.clipKey,
      storyId: slot.news.storyId,
      revision: slot.news.revision,
    };
    const wrong = await call(`${slotPath}/news`, { ...acknowledgment, clipKey: "unowned.mp3" });
    assert.equal(wrong.status, 200);
    assert.equal((JSON.parse(wrong.bytes.toString()) as { recorded: boolean }).recorded, false);
    // Synthetic browser reports only in this labeled smoke session, never a real listener's history.
    for (let i = 0; i < 2; i++) {
      const ack = await call(`${slotPath}/news`, acknowledgment);
      assert.equal(ack.status, 200, ack.bytes.toString());
    }
    const { rows: exposures } = await db.query<{ count: string }>(
      "select count(*) from session_news_exposure where session_id = $1 and seq = 1",
      [sessionId],
    );
    assert.equal(exposures[0].count, "1", "Heard reports must be idempotent and reject the wrong take");
    const original = await call(`${slotPath}/clip?take=${encodeURIComponent(slot.clipKey)}`);
    assert.equal(original.status, 200);
    await db.query(
      "update session_slot set news = jsonb_set(news, '{expiresAt}', to_jsonb((now() - interval '1 minute')::text)) where session_id = $1 and seq = 1",
      [sessionId],
    );
    const live = await call(slotPath, { clockMs: 20 * 3_600_000, live: true });
    assert.equal(live.status, 200, live.bytes.toString());
    const fresh = JSON.parse(live.bytes.toString()) as typeof slot;
    assert.equal(fresh.news.words, null);
    assert.equal(fresh.clipKey, slot.news.fallbackClipKey);
    assert.equal(fresh.legalId, slot.legalId);
    const replay = await call(`${slotPath}/clip?take=${encodeURIComponent(slot.clipKey)}`);
    assert.equal(replay.status, 200);
    const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
    assert.equal(
      hash(replay.bytes),
      hash(original.bytes),
      "Old take must still return original immutable bytes",
    );
    const safe = await call(`${slotPath}/clip?take=${encodeURIComponent(fresh.clipKey)}`);
    assert.equal(safe.status, 200);
    assert.notEqual(hash(safe.bytes), hash(original.bytes));
    const invalid = await call(
      `${slotPath}/clip?take=${encodeURIComponent("sessions/another-session/1.mp3")}`,
    );
    assert.equal(invalid.status, 404);
    // A separate legacy-shaped slot in this same labeled test session must not air unchecked copy.
    await db.query(
      `insert into session_slot (session_id, seq, title, artist, why, hits, qobuz_id, kind,
         words, lead_line, legal_id, clip_key, voiced_at)
       select session_id, 6, title, artist, 'Legacy news smoke', hits, qobuz_id, 'break',
         'Unverified old headline.', lead_line, legal_id, clip_key, voiced_at
       from session_slot where session_id = $1 and seq = 1`,
      [sessionId],
    );
    const legacy = await call(`/api/sessions/${sessionId}/slots/6`, {
      clockMs: 20 * 3_600_000,
      live: true,
    });
    assert.equal(legacy.status, 200, legacy.bytes.toString());
    const safeLegacy = JSON.parse(legacy.bytes.toString()) as typeof slot;
    assert.equal(safeLegacy.news.words, null);
    assert(!safeLegacy.words?.includes("Unverified old headline"));
    assert.equal(safeLegacy.legalId, slot.legalId);
    assert.notEqual(safeLegacy.clipKey, fresh.clipKey);
    assert(safeLegacy.news.previous?.some((take) => take.clipKey === fresh.clipKey));
    console.log(
      "PASS: selection, two voice takes, snapshot persistence, retry/acknowledgment idempotency, expiry fallback, legal ID preservation, immutable replay, take validation and legacy break refresh.",
    );
  } else {
    console.log(
      "PASS: explicit news omission, voiced music break, snapshot persistence and retry idempotency. No selected story; expiry/audio checks not exercised.",
    );
    process.exitCode = 1;
  }
  console.log(`${origin}/sessions/${sessionId}`);
} finally {
  await db.end();
}
