import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./[id]/slots/[seq]/route";
import {
  chartRequest,
  readChart,
  mixRequest,
  readMix,
  type PlanningInput,
  type PlanningReceipt,
  PLANNING_VERSION,
} from "./planning";
import { NEWS_DEFAULTS } from "../../../lib/news";
import type { PreparedEntry, PreparedHeadline, PreparedWeather } from "../../../lib/prepared";
import type { SlotGeneration } from "./generation";
import type { SlotRow } from "./doc";
import type { WriteInput, WriterReceipt } from "./write";
import type { Written } from "./shapes";
import type { PickInput, PickReceipt } from "./pick";
import { pickRequest, readPick } from "./pick";

const boundary = vi.hoisted(() => ({
  query: vi.fn<(sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>>(),
  release: vi.fn(),
  pick: vi.fn<(input: PickInput, config: { apiKey: string; model: string }) => Promise<PickReceipt>>(),
  write:
    vi.fn<(input: WriteInput) => Promise<{ written: Written; thinking: string; receipt?: WriterReceipt }>>(),
  plan: vi.fn<
    (input: PlanningInput, config: { apiKey: string; model: string }) => Promise<PlanningReceipt>
  >(),
  put: vi.fn(),
  news: vi.fn<() => Promise<PreparedEntry<PreparedHeadline[]> | null>>(),
  weather: vi.fn<() => Promise<PreparedEntry<PreparedWeather> | null>>(),
}));
vi.mock("@/lib/db", () => ({
  pool: () => ({
    query: boundary.query,
    connect: () => Promise.resolve({ query: boundary.query, release: boundary.release }),
  }),
}));
vi.mock("@/lib/prepared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/prepared")>()),
  readPreparedNews: boundary.news,
  readPreparedWeather: boundary.weather,
}));
vi.mock("@/lib/bucket", () => ({ bucket: () => ({ put: boundary.put }) }));
vi.mock("@/lib/env", () => ({
  env: () => ({ ELEVENLABS_KEY: "test", TYPESAFE_API_KEY: "test", TYPESAFE_MODEL: "jev-1.13.0" }),
}));
vi.mock("@/lib/settings", () => ({
  loadClock: () => Promise.resolve({ breakEvery: 5 }),
  loadIdentity: () => Promise.resolve({ calls: "WFAI", city: "Dallas", onAir: "Radio" }),
  loadVoices: () => Promise.resolve([{ id: "voice", name: "DJ" }]),
  loadNews: () => Promise.resolve(NEWS_DEFAULTS),
}));
vi.mock("./pick", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./pick")>()),
  producePick: boundary.pick,
}));
vi.mock("./planning", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./planning")>()),
  producePlan: boundary.plan,
}));
vi.mock("./write", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./write")>()),
  produceWrite: boundary.write,
}));

const id = "be5c8489-491d-4af4-a3e4-79c48f5bf341";
const hits = ["first", "chosen"].map((id) => ({
  id,
  title: "Song",
  artists: ["Artist"],
  album: "Album",
  durationMs: 200000,
  image: null,
}));
const receipt = () =>
  readPick(
    pickRequest(
      { prompt: "play Song", proposal: { title: "Song", artist: "Artist", why: "requested" }, hits },
      "jev-1.13.0",
    ),
    {
      model: "jev-1.13.0",
      answers: {
        pick: {
          type: "choice",
          choice: "chosen",
          confidence: 1,
          probabilities: { first: 0, chosen: 1, none: 0 },
        },
      },
      usage: { input_tokens: 100, output_tokens: 20 },
    },
    1,
  );
const planningReceipt = (action = "sweeper") => {
  const input: PlanningInput = {
    prompt: "play Song",
    seq: 2,
    clockSaysBreak: action.startsWith("break"),
    stationName: "Radio",
    proposal: { title: "Song", artist: "Artist", why: "requested" },
    hit: hits[1],
    recent: [],
  };
  const raw = (
    req: { questions: Record<string, { criteria: Record<string, string> }> },
    choices: Record<string, string>,
  ) => ({
    model: "jev-1.13.0",
    usage: { input_tokens: 1, output_tokens: 1 },
    answers: Object.fromEntries(
      Object.entries(req.questions).map(([id, q]) => [
        id,
        {
          type: "choice",
          choice: choices[id],
          confidence: 1,
          probabilities: Object.fromEntries(
            Object.keys(q.criteria).map((k) => [k, k === choices[id] ? 1 : 0]),
          ),
        },
      ]),
    ),
  });
  const req = chartRequest(input, "jev-1.13.0");
  const chart = readChart(
    req,
    raw(req, { post: "3", ending: "cold", energy: "3", tempo: "mid", mood: "warm" }),
    1,
  );
  const mixReq = mixRequest(input, chart, "jev-1.13.0");
  const mix = readMix(mixReq, raw(mixReq, { action }), 1);
  return { version: PLANNING_VERSION, plan: mix.plan, chart, mix, elapsedMs: 2 };
};
let row: SlotRow & { id: string };
let prior: (SlotRow & { id: string })[] = [];
const call = (body: Record<string, unknown> = {}) =>
  POST(
    new Request(`http://radio/api/sessions/${id}/slots/2`, {
      method: "POST",
      body: JSON.stringify({ clockMs: 1000, ...body }),
    }),
    { params: Promise.resolve({ id, seq: String(row.seq) }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  prior = [];
  boundary.news.mockResolvedValue(null);
  boundary.weather.mockResolvedValue(null);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  row = {
    id: "slot",
    seq: 2,
    title: "Song",
    artist: "Artist",
    why: "requested",
    hits,
    qobuz_id: null,
    clock_ms: null,
    ramp_ms: null,
    sure: null,
    post: null,
    outro: null,
    outro_ms: null,
    energy: null,
    tempo: null,
    mood: null,
    kind: null,
    words: null,
    lead_line: null,
    legal_id: null,
    treatment: null,
    fallback: null,
    record_under_ms: null,
    voice_in_ms: null,
    clip_key: null,
    voiced_at: null,
  };
  boundary.pick.mockResolvedValue(receipt());
  boundary.plan.mockResolvedValue(planningReceipt());
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(new Uint8Array([1, 2, 3])))),
  );
  boundary.write.mockImplementation(({ plan }) =>
    Promise.resolve({
      thinking: "",
      written: {
        words: plan.fixedWords ?? "A little sunshine to keep this show moving.",
        leadLine: plan.kind === "break" ? "Here is Song." : "",
      },
    }),
  );
  boundary.query.mockImplementation((sql: string, values: unknown[] = []) => {
    if (sql.includes("select prompt, voice_id"))
      return Promise.resolve({ rows: [{ prompt: "play Song", voice_id: "voice" }] });
    if (sql.startsWith("select qobuz_id from session_slot"))
      return Promise.resolve({ rows: [{ qobuz_id: row.qobuz_id }] });
    if (sql.includes("from session_slot where session_id = $1 and seq = $2"))
      return Promise.resolve({ rows: [row] });
    if (sql.startsWith("select seq, generation, news")) return Promise.resolve({ rows: prior });
    if (sql.startsWith("update session_slot set generation")) {
      row = { ...row, generation: JSON.parse(values[1] as string) as SlotGeneration };
      return Promise.resolve({ rows: [row] });
    }
    if (sql.includes("qobuz_id = $2, clock_ms")) {
      row = {
        ...row,
        qobuz_id: values[1] as string,
        ramp_ms: values[3] as number,
        sure: values[4] as boolean,
        post: values[5] as string,
        outro: values[6] as string,
        outro_ms: values[7] as number,
        energy: values[8] as number,
        tempo: values[9] as string,
        mood: values[10] as string,
        kind: values[11] as string,
        words: values[12] as string,
        lead_line: values[13] as string,
        treatment: values[15] as string,
        legal_id: values[14] as string | null,
        news: values[20] ? (JSON.parse(values[20] as string) as SlotRow["news"]) : null,
        generation: JSON.parse(values[22] as string) as SlotGeneration,
      };
      return Promise.resolve({ rows: [row] });
    }
    if (sql.startsWith("update session_slot set clip_key")) {
      row = {
        ...row,
        clip_key: values[1] as string,
        voiced_at: new Date(),
        news: values[2] ? (JSON.parse(values[2] as string) as SlotRow["news"]) : null,
        generation: values[3] ? (JSON.parse(values[3] as string) as SlotGeneration) : null,
      };
      return Promise.resolve({ rows: [row] });
    }
    if (sql.startsWith("update session_slot set voiced_at")) {
      row = { ...row, voiced_at: new Date() };
      return Promise.resolve({ rows: [row] });
    }
    return Promise.resolve({ rows: [] });
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("slot selection has one path", () => {
  it("writes and persists exactly Jev's pick and receipt", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ pick: { id: "chosen" } });
    expect(boundary.write).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ hit: hits[1], plan: planningReceipt().plan }),
    );
    expect(boundary.write.mock.calls[0][0]).not.toHaveProperty("hits");
    const update = boundary.query.mock.calls.find(([sql]) => String(sql).includes("qobuz_id = $2, clock_ms"));
    expect(update?.[1]?.[1]).toBe("chosen");
    expect(JSON.parse(update?.[1]?.[21] as string)).toEqual({ ...receipt(), planning: planningReceipt() });
  });

  it.each(["Jev HTTP 500", "Jev timed out", "Invalid Jev response"])(
    "%s stops before writing or voicing",
    async (message) => {
      boundary.pick.mockRejectedValue(new Error(message));
      const res = await call();
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: message });
      expect(boundary.pick).toHaveBeenCalledTimes(1);
      expect(boundary.write).not.toHaveBeenCalled();
      expect(boundary.put).not.toHaveBeenCalled();
      expect(boundary.query.mock.calls.some(([sql]) => String(sql).startsWith("update session_slot"))).toBe(
        false,
      );
      expect(boundary.query).toHaveBeenCalledWith("rollback");
    },
  );

  it.each(["Jev planning timed out", "Invalid Jev planning response"])(
    "%s stops before prose or voice",
    async (message) => {
      boundary.plan.mockRejectedValue(new Error(message));
      const res = await call();
      expect(res.status).toBe(502);
      expect(boundary.write).not.toHaveBeenCalled();
      expect(boundary.put).not.toHaveBeenCalled();
    },
  );
  it("a Jev segue needs no Claude or ElevenLabs call", async () => {
    boundary.plan.mockResolvedValue(planningReceipt("segue"));
    expect((await call()).status).toBe(200);
    expect(boundary.write).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("invalid copy does not change Jev's action", async () => {
    boundary.write.mockResolvedValue({ thinking: "", written: { words: "", leadLine: "" } });
    expect((await call()).status).toBe(502);
    expect(row.qobuz_id).toBeNull();
    expect(boundary.plan).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("none fails; it does not use the first hit", async () => {
    boundary.pick.mockResolvedValue({ ...receipt(), pick: null });
    expect((await call()).status).toBe(502);
    expect(boundary.write).not.toHaveBeenCalled();
    expect(row.qobuz_id).toBeNull();
  });

  it("a writer failure fails the slot rather than inventing a segue", async () => {
    boundary.write.mockRejectedValue(new Error("No usable copy"));
    expect((await call()).status).toBe(502);
    expect(row.qobuz_id).toBeNull();
    expect(boundary.put).not.toHaveBeenCalled();
    expect(boundary.query).toHaveBeenCalledWith("rollback to savepoint generation_ready");
    expect(row.generation?.selection.pick).toBe("chosen");
    boundary.write.mockResolvedValue({ thinking: "", written: { words: "Radio.", leadLine: "" } });
    expect((await call()).status).toBe(200);
    expect(boundary.pick).toHaveBeenCalledTimes(1);
    expect(boundary.plan).toHaveBeenCalledTimes(1);
  });

  it("retrying a written slot voices the retained recording without selecting again", async () => {
    row = { ...row, qobuz_id: "chosen", kind: "segue" };
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ pick: { id: "chosen" } });
    expect(boundary.pick).not.toHaveBeenCalled();
    expect(boundary.write).not.toHaveBeenCalled();
  });
});

const headlines = (): PreparedHeadline[] =>
  ["a", "b", "c", "d"].map((id) => ({
    articleId: id,
    storyId: `story-${id}`,
    revision: "v1",
    title: `Dallas event ${id}`,
    topic: "music",
    sourceId: "kxt",
    source: "KXT",
    url: `https://kxt.org/${id}`,
    scope: "culture",
    publishedAt: new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    checkedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    evidence: "A free Dallas concert.",
    facts: [{ text: "A free Dallas concert.", quote: "A free Dallas concert." }],
  }));
const weather: PreparedWeather = {
  location: {
    city: "Dallas",
    zip: "75229",
    timeZone: "America/Chicago",
    station: "KDAL",
    grid: "FWD/87,109",
  },
  sources: {
    observation: "https://api.weather.gov/o",
    forecast: "https://api.weather.gov/f",
    alerts: "https://api.weather.gov/a",
  },
  units: { temperature: "F", wind: "mph", precipitation: "percent" },
  observedAt: new Date().toISOString(),
  forecastUpdatedAt: new Date().toISOString(),
  now: { text: "Sunny", tempF: 80, feelsLikeF: null, humidity: null, windMph: null },
  alerts: [],
  periods: [
    {
      name: "Tonight",
      isDaytime: false,
      startTime: new Date().toISOString(),
      endTime: new Date(Date.now() + 3600000).toISOString(),
      tempF: 70,
      short: "Clear",
      detailed: "Clear skies",
      precipitationPercent: 0,
      windSpeed: "5 mph",
      windDirection: "S",
    },
  ],
};
const prepareBreak = (count = "1") => {
  row.seq = 1;
  boundary.plan.mockResolvedValue(planningReceipt("break_dry"));
  boundary.news.mockResolvedValue({
    id: "edition",
    date: "2026-09-19",
    preparedAt: new Date(),
    expiresAt: new Date(Date.now() + 3600000),
    data: headlines(),
  });
  boundary.weather.mockResolvedValue({
    id: "weather",
    date: "2026-09-19",
    preparedAt: new Date(),
    expiresAt: new Date(Date.now() + 3600000),
    data: weather,
  });
  vi.mocked(fetch).mockImplementation((url, init) => {
    if ((typeof url === "string" ? url : url instanceof URL ? url.href : url.url).includes("typesafe.ai")) {
      const req = JSON.parse(init?.body as string) as {
        questions: Record<string, { criteria: Record<string, string> }>;
      };
      return Promise.resolve(
        Response.json({
          model: "jev-1.13.0",
          usage: { input_tokens: 10, output_tokens: 10 },
          answers: Object.fromEntries(
            Object.entries(req.questions).map(([id, question]) => [
              id,
              {
                type: "choice",
                choice: id === "count" ? count : Object.keys(question.criteria)[0],
                confidence: 1,
                probabilities: Object.fromEntries(
                  Object.keys(question.criteria).map((option, index) => [
                    option,
                    id === "count" ? Number(option === count) : Number(index === 0),
                  ]),
                ),
              },
            ]),
          ),
        }),
      );
    }
    return Promise.resolve(new Response(new Uint8Array([1, 2, 3])));
  });
};
describe("saved post timing reaches playback", () => {
  it("retains alignment in the slot JSON and returns it on production and retry", async () => {
    boundary.plan.mockResolvedValue(planningReceipt("station"));
    const first = await call();
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ finishAtMs: 3000, chart: { postTiming: "3" } });
    expect(row.generation?.input.plan.finishAtMs).toBe(3000);
    const repeated = await call();
    expect(await repeated.json()).toMatchObject({ finishAtMs: 3000, chart: { postTiming: "3" } });
    expect(boundary.plan).toHaveBeenCalledTimes(1);
  });
});

describe("prepared news/weather has one production path", () => {
  it("passes two ranked stories to the writer, budgets both, and reserves both against repeats", async () => {
    prepareBreak("2");
    expect((await call()).status).toBe(200);
    expect(boundary.write.mock.calls[0][0].headlines.map((h) => h.articleId)).toEqual(["a", "b"]);
    expect(boundary.plan.mock.calls[0][0].contentWords).toBe(75);
    expect(row.generation?.news.selected.map((h) => h.articleId)).toEqual(["a", "b"]);
    const original = structuredClone(row);
    prior = [original];
    row = {
      ...row,
      id: "second",
      seq: 6,
      qobuz_id: null,
      voiced_at: null,
      clip_key: null,
      generation: null,
      news: null,
    };
    expect((await call()).status).toBe(200);
    expect(boundary.write.mock.calls[1][0].headlines.map((h) => h.articleId)).toEqual(["c", "d"]);
  });
  it("uses DB editions, one writer and one TTS, and retains the exact selected evidence", async () => {
    prepareBreak();
    expect((await call()).status).toBe(200);
    expect(boundary.write).toHaveBeenCalledTimes(1);
    expect(boundary.write.mock.calls[0][0].headlines).toHaveLength(1);
    expect(boundary.write.mock.calls[0][0].weather).toEqual(weather);
    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter(([url]) =>
          (typeof url === "string" ? url : url instanceof URL ? url.href : url.url).includes("elevenlabs.io"),
        ),
    ).toHaveLength(1);
    expect(
      vi
        .mocked(fetch)
        .mock.calls.every(([url]) =>
          /typesafe.ai|elevenlabs.io/.test(
            typeof url === "string" ? url : url instanceof URL ? url.href : url.url,
          ),
        ),
    ).toBe(true);
    expect(row.generation?.news.selected).toHaveLength(1);
    expect(row.generation?.takes).toHaveLength(1);
    const original = structuredClone(row);
    prior = [original];
    row = {
      ...row,
      id: "second",
      seq: 6,
      qobuz_id: null,
      voiced_at: null,
      clip_key: null,
      generation: null,
      news: null,
    };
    expect((await call()).status).toBe(200);
    expect(boundary.write.mock.calls[1][0].headlines.map((h) => h.articleId)).toEqual(["b"]);
  });
  it("retains rejected copy and retries with the same Jev decisions", async () => {
    prepareBreak();
    const bad = { words: "word ".repeat(200), leadLine: "Song." };
    const receipt: WriterReceipt = {
      version: "script-2",
      model: "test",
      system: "test",
      brief: "test",
      response: bad,
      usage: {},
      elapsedMs: 1,
    };
    boundary.write.mockResolvedValueOnce({ written: bad, thinking: "", receipt });
    expect((await call()).status).toBe(502);
    expect(row.qobuz_id).toBeNull();
    expect(row.generation?.attempts?.[0].writer).toEqual(receipt);
    expect(row.generation?.attempts?.[0].error).toContain("word budget");
    const choices = structuredClone(row.generation?.news);
    expect((await call()).status).toBe(200);
    expect(boundary.pick).toHaveBeenCalledTimes(1);
    expect(row.generation?.news).toEqual(choices);
    expect(row.generation?.attempts?.[0].writer).toEqual(receipt);
    expect(row.generation?.takes).toHaveLength(1);
  });
  it("missing prepared material produces one music script without fetching sources", async () => {
    row.seq = 1;
    boundary.plan.mockResolvedValue(planningReceipt("break_dry"));
    expect((await call()).status).toBe(200);
    expect(boundary.write.mock.calls[0][0]).toMatchObject({ headlines: [], weather: null });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("a voice failure keeps the script and retry only voices it", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("failed", { status: 500 }));
    expect((await call()).status).toBe(502);
    expect(row.qobuz_id).toBe("chosen");
    const kept = row.words;
    expect((await call()).status).toBe(200);
    expect(row.words).toBe(kept);
    expect(boundary.write).toHaveBeenCalledTimes(1);
    expect(boundary.pick).toHaveBeenCalledTimes(1);
  });
  it("saved production stays playable regardless of news expiry", async () => {
    prepareBreak();
    await call();
    Object.assign(row.news!, { expiresAt: new Date(0).toISOString() });
    const kept = structuredClone(row);
    vi.mocked(fetch).mockClear();
    boundary.write.mockClear();
    const response = await call({ live: true });
    expect(await response.json()).toMatchObject({
      clipKey: kept.clip_key,
      words: kept.words,
      legalId: kept.legal_id,
    });
    expect(row).toEqual(kept);
    expect(fetch).not.toHaveBeenCalled();
    expect(boundary.write).not.toHaveBeenCalled();
  });
  it("explicit voice retries preserve all earlier takes without reselecting or rewriting", async () => {
    prepareBreak();
    await call();
    const original = row.clip_key;
    await call({ again: true });
    expect(row.generation?.takes).toHaveLength(2);
    expect(row.generation?.takes?.[0].clipKey).toBe(original);
    expect(row.clip_key).not.toBe(original);
    expect(boundary.write).toHaveBeenCalledTimes(1);
  });
});
