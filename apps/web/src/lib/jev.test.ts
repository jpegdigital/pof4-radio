import { describe, expect, it, vi } from "vitest";
import { askJev, JevError, type JevRequest, readJev } from "./jev";

const question = (options: string[]) => ({
  type: "choice" as const,
  instructions: "Choose one.",
  criteria: Object.fromEntries(options.map((o) => [o, `Option ${o}`])),
});
const request = (
  questions: JevRequest["questions"] = { pick: question(["a", "b", "none"]) },
): JevRequest => ({
  model: "jev-1.13.0",
  state: { prompt: "warm evening radio" },
  questions,
});
const answer = (choice: string, probabilities: Record<string, number>, over = {}) => ({
  type: "choice",
  choice,
  confidence: 0.9,
  probabilities,
  ...over,
});
const reply = (answers: Record<string, unknown>, over = {}) => ({
  model: "jev-1.13.0",
  answers,
  usage: { input_tokens: 100, output_tokens: 20 },
  ...over,
});
const good = () => reply({ pick: answer("b", { a: 0.05, b: 0.9, none: 0.05 }) });

describe("readJev — an answer is held to the menu that was sent", () => {
  it("returns the model, every answer and the usage as given", () => {
    const response = readJev(request(), good());
    expect(response.model).toBe("jev-1.13.0");
    expect(response.answers.pick.choice).toBe("b");
    expect(response.answers.pick.probabilities).toEqual({ a: 0.05, b: 0.9, none: 0.05 });
    expect(response.usage).toEqual({ input_tokens: 100, output_tokens: 20 });
  });

  it("keeps the declared choice; the probabilities are audit data, never a recount", () => {
    const raw = reply({ pick: answer("a", { a: 0.49, b: 0.5, none: 0.01 }, { confidence: 0.01 }) });
    expect(readJev(request(), raw).answers.pick.choice).toBe("a");
  });

  // Each probability is rounded to 0.01, so an honest n-option distribution may be off by n × 0.005.
  it.each([
    { id: "3 options, 0.01 under", options: 3, sum: 0.99 },
    { id: "13 options, 0.06 under", options: 13, sum: 0.94 },
    { id: "13 options, 0.06 over", options: 13, sum: 1.06 },
  ])("accepts rounding that scales with the menu: $id", ({ options, sum }) => {
    const names = Array.from({ length: options }, (_, i) => `headline_${i}`);
    const rest = 0.01;
    const probabilities = Object.fromEntries(
      names.map((name, i) => [name, i === 0 ? Number((sum - rest * (options - 1)).toFixed(2)) : rest]),
    );
    const raw = reply({ ranking: answer("headline_0", probabilities) });
    expect(readJev(request({ ranking: question(names) }), raw).answers.ranking.choice).toBe("headline_0");
  });

  it.each([
    { id: "not an object", raw: null },
    { id: "wrong model", raw: { ...good(), model: "jev-0.0.1" } },
    { id: "no answers", raw: reply({}) },
    {
      id: "an answer nobody asked for",
      raw: reply({ ...good().answers, extra: answer("x", { x: 1 }) }),
    },
    { id: "choice outside the menu", raw: reply({ pick: answer("z", { a: 0, b: 1, none: 0 }) }) },
    {
      id: "missing choice",
      raw: reply({ pick: answer("b", { a: 0, b: 1, none: 0 }, { choice: undefined }) }),
    },
    {
      id: "wrong answer type",
      raw: reply({ pick: answer("b", { a: 0, b: 1, none: 0 }, { type: "score" }) }),
    },
    {
      id: "confidence above one",
      raw: reply({ pick: answer("b", { a: 0, b: 1, none: 0 }, { confidence: 2 }) }),
    },
    { id: "missing option", raw: reply({ pick: answer("b", { b: 1 }) }) },
    { id: "unknown option", raw: reply({ pick: answer("b", { a: 0, b: 0.5, none: 0, x: 0.5 }) }) },
    { id: "probability out of range", raw: reply({ pick: answer("b", { a: -1, b: 2, none: 0 }) }) },
    { id: "sum far below one", raw: reply({ pick: answer("b", { a: 0.1, b: 0.1, none: 0.1 }) }) },
    {
      id: "sum beyond the rounding allowance",
      raw: reply({ pick: answer("b", { a: 0.05, b: 0.9, none: 0.08 }) }),
    },
    { id: "all zero", raw: reply({ pick: answer("b", { a: 0, b: 0, none: 0 }) }) },
    { id: "missing usage", raw: { model: "jev-1.13.0", answers: good().answers } },
  ])("refuses $id", ({ raw }) => {
    expect(() => readJev(request(), raw)).toThrow(JevError);
  });

  it("names the question at fault", () => {
    const raw = reply({
      post: answer("1", { "0": 0, "1": 1 }),
      ending: answer("invented", { cold: 1, unknown: 0 }),
    });
    const req = request({ post: question(["0", "1"]), ending: question(["cold", "unknown"]) });
    expect(() => readJev(req, raw)).toThrow(/choice.*ending/i);
  });
});

describe("askJev — one POST, timed, unread", () => {
  const ok = () => vi.fn<typeof fetch>(() => Promise.resolve(Response.json(good())));

  it("posts the exact request with the bearer key and returns the raw answer", async () => {
    const fetchFn = ok();
    const { raw, elapsedMs } = await askJev(request(), {
      apiKey: "key",
      what: "recording selection",
      fetchFn,
    });
    expect(raw).toEqual(good());
    expect(elapsedMs).toBeGreaterThanOrEqual(0);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer key" });
    expect(JSON.parse(init?.body as string)).toEqual(request());
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("refuses to call without a key, naming the variable", async () => {
    const fetchFn = ok();
    await expect(askJev(request(), { apiKey: "", what: "mixer planning", fetchFn })).rejects.toThrow(
      /TYPESAFE_API_KEY.*mixer planning/,
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("a failed call carries what was asked, the status and the body", async () => {
    const fetchFn = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response("quota exceeded", { status: 429 })),
    );
    const err = await askJev(request(), { apiKey: "key", what: "headline selection", fetchFn }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(JevError);
    expect((err as JevError).status).toBe(429);
    expect((err as JevError).message).toMatch(/headline selection.*429.*quota exceeded/);
  });

  it("the caller's timeout overrides the default", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    await askJev(request(), { apiKey: "key", what: "recording selection", fetchFn: ok() });
    await askJev(request(), { apiKey: "key", what: "headline selection", timeoutMs: 30_000, fetchFn: ok() });
    expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([15_000, 30_000]);
    timeout.mockRestore();
  });
});
