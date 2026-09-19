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
import type { SlotRow } from "./doc";
import type { WriteInput } from "./write";
import type { Written } from "./shapes";
import type { PickInput, PickReceipt } from "./pick";
import { pickRequest, readPick } from "./pick";

const boundary = vi.hoisted(() => ({
  query: vi.fn<(sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>>(),
  release: vi.fn(),
  pick: vi.fn<(input: PickInput, config: { apiKey: string; model: string }) => Promise<PickReceipt>>(),
  write: vi.fn<(input: WriteInput) => Promise<{ written: Written; thinking: string }>>(),
  plan: vi.fn<
    (input: PlanningInput, config: { apiKey: string; model: string }) => Promise<PlanningReceipt>
  >(),
  put: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  pool: () => ({
    query: boundary.query,
    connect: () => Promise.resolve({ query: boundary.query, release: boundary.release }),
  }),
}));
vi.mock("@/lib/bucket", () => ({ bucket: () => ({ put: boundary.put }) }));
vi.mock("@/lib/env", () => ({
  env: () => ({ ELEVENLABS_KEY: "test", TYPESAFE_API_KEY: "test", TYPESAFE_MODEL: "jev-1.13.0" }),
}));
vi.mock("@/lib/settings", () => ({
  loadClock: () => Promise.resolve({ breakEvery: 5 }),
  loadIdentity: () => Promise.resolve({ calls: "WFAI", city: "Dallas", onAir: "Radio" }),
  loadVoices: () => Promise.resolve([{ id: "voice", name: "DJ" }]),
  loadNews: () => Promise.resolve({ enabled: false }),
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
    clockSaysBreak: false,
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
    raw(req, { intro: "10", ending: "cold", energy: "3", tempo: "mid", mood: "warm" }),
    1,
  );
  const mixReq = mixRequest(input, chart, "jev-1.13.0");
  const mix = readMix(mixReq, raw(mixReq, { action }), 1);
  return { version: PLANNING_VERSION, plan: mix.plan, chart, mix, elapsedMs: 2 };
};
let row: SlotRow & { id: string };
const call = () =>
  POST(
    new Request(`http://radio/api/sessions/${id}/slots/2`, {
      method: "POST",
      body: JSON.stringify({ clockMs: 1000 }),
    }),
    { params: Promise.resolve({ id, seq: "2" }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
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
      written: { words: plan.fixedWords ?? "A little sunshine to keep this show moving.", leadLine: "" },
    }),
  );
  boundary.query.mockImplementation((sql: string, values: unknown[] = []) => {
    if (sql.includes("select prompt, voice_id"))
      return Promise.resolve({ rows: [{ prompt: "play Song", voice_id: "voice" }] });
    if (sql.startsWith("select qobuz_id from session_slot"))
      return Promise.resolve({ rows: [{ qobuz_id: row.qobuz_id }] });
    if (sql.includes("from session_slot where session_id = $1 and seq = $2"))
      return Promise.resolve({ rows: [row] });
    if (sql.includes("qobuz_id = $2, clock_ms")) {
      row = {
        ...row,
        qobuz_id: values[1] as string,
        kind: values[11] as string,
        words: values[12] as string,
        lead_line: values[13] as string,
        treatment: values[15] as string,
      };
      return Promise.resolve({ rows: [row] });
    }
    if (sql.startsWith("update session_slot set clip_key")) {
      row = { ...row, clip_key: values[1] as string, voiced_at: new Date() };
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
    expect(boundary.query).toHaveBeenCalledWith("rollback");
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
