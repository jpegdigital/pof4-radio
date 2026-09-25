/** Real, billed integration check. Creates and retains one labeled session with two full breaks.
 * DATABASE_URL and normal web secrets are required. RADIO_SMOKE_ORIGIN selects local or deployed web.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import pg from "pg";
import type { Hit, SlotDoc } from "../src/app/api/sessions/doc.ts";
import type { SlotGeneration } from "../src/app/api/sessions/generation.ts";

const origin = process.env.RADIO_SMOKE_ORIGIN ?? "https://radio.pof4.com";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
const call = async (path: string, body?: unknown) => {
  const response = await fetch(new URL(path, origin), {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(180000),
  });
  assert.equal(response.status, 200, await response.clone().text());
  return response;
};
try {
  const { rows: settings } = await db.query<{ key: string; value: string }>(
    "select key, value from settings where key in ('voices', 'clock')",
  );
  const roster = JSON.parse(settings.find((r) => r.key === "voices")?.value ?? "[]") as { id: string }[];
  const clock = JSON.parse(settings.find((r) => r.key === "clock")?.value ?? "{}") as { breakEvery: number };
  assert(roster[0] && clock.breakEvery, "Need the production voice and clock settings");
  const { rows: hits } = await db.query<{ title: string; artist: string; hits: Hit[] }>(
    "select title, artists->>0 as artist, jsonb_build_array(jsonb_build_object('id',id,'title',title,'artists',artists,'album',album,'image',image,'durationMs',duration_ms)) as hits from track order by created_at desc limit 1",
  );
  assert(hits[0], "Need an existing catalog hit");
  let sessionId = process.env.RADIO_SMOKE_SESSION;
  if (sessionId) {
    const { rows } = await db.query<{ prompt: string }>("select prompt from session where id=$1", [
      sessionId,
    ]);
    assert(rows[0]?.prompt.startsWith("[Prepared pipeline smoke "), "Resume only a labeled smoke session");
  } else {
    const created = await call("/api/sessions", {
      voiceId: roster[0].id,
      prompt: `[Prepared pipeline smoke ${new Date().toISOString()}] A Dallas music discovery show with current AI developments, local Dallas news, interesting science and culture, and a concise weather update. Include worthwhile fresh headlines, without repeating stories.`,
    });
    sessionId = ((await created.json()) as { sessionId: string }).sessionId;
  }
  console.log(`Smoke session: ${sessionId}`);
  const generated: SlotGeneration[] = [];
  let first: SlotDoc | undefined;
  for (const seq of [1, 1 + clock.breakEvery]) {
    await db.query(
      "insert into session_slot (session_id, seq, title, artist, why, hits) values ($1,$2,$3,$4,$5,$6) on conflict (session_id, seq) do nothing",
      [
        sessionId,
        seq,
        hits[0].title,
        hits[0].artist,
        "Prepared pipeline integration verification using a retained catalog hit",
        JSON.stringify(hits[0].hits),
      ],
    );
    const started = Date.now();
    const slot = (await (
      await call(`/api/sessions/${sessionId}/slots/${seq}`, { clockMs: 16 * 3600000 })
    ).json()) as SlotDoc;
    assert(slot.voiced && slot.clipKey && slot.news?.version === "raw-news-1");
    const { rows }: pg.QueryResult<{ generation: SlotGeneration }> = await db.query<{
      generation: SlotGeneration;
    }>("select generation from session_slot where session_id=$1 and seq=$2", [sessionId, seq]);
    const generation: SlotGeneration = rows[0].generation;
    assert(generation.writer?.model && generation.writer.response, "Exact Claude output must be retained");
    assert(
      generation.news.choice.request && generation.selection.planning,
      "Jev inputs and decisions must be retained",
    );
    assert.equal(generation.takes?.length, 1, "Only one take per generated break");
    if (generation.input.audioTags) {
      const tts = generation.takes[0].request as { text: string; model_id: string };
      assert.equal(tts.model_id, "eleven_v3");
      assert(/\[[^\]]+\]/u.test(tts.text), "Claude should supply inline emotion tags to v3");
      assert(tts.text.includes(slot.words ?? ""), "Tagged copy must reach TTS unchanged");
    }
    assert(
      !/with some headlines|news tucked in between|a quick weather update/iu.test(slot.words ?? ""),
      "Avoid announcing the show format",
    );
    if (seq === 1 && generation.input.dj)
      assert(
        slot.words?.includes(generation.input.dj),
        "A new show must introduce the DJ by name in the unified script",
      );
    assert(generation.input.headlines.length <= 2);
    assert(generation.input.weather, "This live check requires a fresh weather edition");
    const report = generation.input.weatherReport;
    assert(report, "This live check requires a saved weather report");
    assert.equal(report.at, generation.preparedAt);
    assert.equal(report.mode, seq === 1 ? "full" : "hourly");
    if (seq !== 1) {
      assert.equal(report.outlook.length, 0);
      assert.equal(report.current?.basis, "forecast");
    }
    if (!generated.length)
      assert(
        generation.input.headlines.length > 0,
        "This live check requires at least one suitable prepared headline",
      );
    const prior = new Set(generated.flatMap((g) => g.news.selected.map((h) => h.storyId)));
    assert(
      generation.news.selected.every((h) => !prior.has(h.storyId)),
      "Later breaks must not reuse reserved stories",
    );
    generated.push(generation);
    first ??= slot;
    console.log(
      JSON.stringify({
        seq,
        elapsedMs: Date.now() - started,
        selected: generation.input.headlines.map((h) => ({ title: h.title, source: h.source })),
        weatherEntry: generation.weather?.entryId,
        script: slot.words,
        takes: generation.takes?.length,
      }),
    );
    const retry = (await (
      await call(`/api/sessions/${sessionId}/slots/${seq}`, { clockMs: 16 * 3600000 })
    ).json()) as SlotDoc;
    assert.equal(retry.clipKey, slot.clipKey);
  }
  assert(first?.clipKey && first.news);
  const path = `/api/sessions/${sessionId}/slots/1`;
  const clipPath = `${path}/clip?take=${encodeURIComponent(first.clipKey)}`;
  const originalAudio = new Uint8Array(await (await call(clipPath)).arrayBuffer());
  const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const heard = (await (await call(`${path}/news`, { clipKey: first.clipKey })).json()) as {
    recorded: boolean;
  };
  assert(heard.recorded);
  const { rows: exposure } = await db.query<{ count: string }>(
    "select count(*) from session_news_exposure where session_id=$1 and seq=1",
    [sessionId],
  );
  assert.equal(Number(exposure[0].count), first.news.stories?.length);
  assert.equal(
    ((await (await call(`${path}/news`, { clipKey: first.clipKey })).json()) as { recorded: boolean })
      .recorded,
    false,
  );
  // Expire only this labeled test receipt; restore it even if verification fails.
  try {
    await db.query(
      "update session_slot set news=jsonb_set(news, '{expiresAt}', to_jsonb('2000-01-01T00:00:00Z'::text)) where session_id=$1 and seq=1",
      [sessionId],
    );
    const live = (await (await call(path, { clockMs: 16 * 3600000, live: true })).json()) as SlotDoc;
    assert.equal(live.clipKey, first.clipKey);
    assert.equal(live.words, first.words);
    assert.equal(live.legalId, first.legalId);
    const { rows } = await db.query<{ words: string; clip_key: string; generation: SlotGeneration }>(
      "select words,clip_key,generation from session_slot where session_id=$1 and seq=1",
      [sessionId],
    );
    assert.equal(rows[0].words, first.words);
    assert.equal(rows[0].clip_key, first.clipKey);
    assert.deepEqual(rows[0].generation, generated[0]);
    assert.equal(hash(new Uint8Array(await (await call(clipPath)).arrayBuffer())), hash(originalAudio));
  } finally {
    await db.query("update session_slot set news=$2 where session_id=$1 and seq=1", [
      sessionId,
      JSON.stringify(first.news),
    ]);
  }
  console.log(
    "PASS: two real breaks, no repeated stories, retained Jev/Claude inputs and outputs, one take each, idempotent retries, all-story exposure, saved production plays unchanged after source expiry.",
  );
  console.log(`Retained session: ${origin}/sessions/${sessionId}`);
} finally {
  await db.end();
}
