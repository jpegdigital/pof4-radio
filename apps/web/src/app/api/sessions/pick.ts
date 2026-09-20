import { prompts } from "../../../lib/prompts/index.ts";
import { z } from "zod";

/** One recording decision. No retries, substitute recording, or second decision maker. */
export const PICK_MODEL = "jev-1.13.0";
export const PICK_VERSION = "recording-1";
const PICK_URL = "https://api.typesafe.ai/v1/systemone";
const PICK_TIMEOUT_MS = 15_000;
const NONE = "none";

export const PickInput = z.object({
  prompt: z.string().min(1),
  proposal: z.object({ title: z.string(), artist: z.string(), why: z.string() }),
  hits: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string(),
        artists: z.array(z.string()),
        album: z.string(),
        image: z.string().nullable(),
        durationMs: z.number().nonnegative(),
      }),
    )
    .min(1)
    .max(254),
});
export type PickInput = z.infer<typeof PickInput>;

/** The exact request is retained so a decision can be inspected and replayed. */
export function pickRequest(input: PickInput, model: string) {
  const state = PickInput.parse(input);
  const ids = state.hits.map((h) => h.id);
  if (new Set(ids).size !== ids.length || ids.includes(NONE))
    throw new Error("Jev selection requires unique hit IDs, excluding 'none'");
  return {
    model,
    state,
    questions: {
      pick: prompts.recording.render(state.hits),
    },
  };
}
export type PickRequest = ReturnType<typeof pickRequest>;

const probability = z.number().min(0).max(1);
const PickResponse = z.object({
  model: z.string().min(1),
  answers: z.object({
    pick: z.object({
      type: z.literal("choice"),
      choice: z.string(),
      confidence: probability,
      probabilities: z.record(z.string(), probability),
    }),
  }),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
});

/** Validate the distribution against the actual menu; confidence is recorded, never a gate. */
export function readPick(request: PickRequest, raw: unknown, elapsedMs: number) {
  const parsed = PickResponse.safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid Jev selection response: ${parsed.error.message}`);
  const response = parsed.data;
  const answer = response.answers.pick;
  const options = Object.keys(request.questions.pick.criteria);
  const entries = Object.entries(answer.probabilities);
  if (
    !options.includes(answer.choice) ||
    entries.length !== options.length ||
    entries.some(([id]) => !options.includes(id))
  )
    throw new Error("Invalid Jev selection: choice or probabilities outside the supplied hits");
  // Jev's explicit choice is authoritative; reported probabilities are audit data.
  const sum = entries.reduce((n, [, p]) => n + p, 0);
  if (
    // TypeSafe rounds each probability to two decimal places.
    sum <= 0 ||
    Math.abs(sum - 1) > entries.length * 0.005 + 0.000001
  )
    throw new Error("Invalid Jev selection probability distribution");
  return {
    version: PICK_VERSION,
    pick: answer.choice === NONE ? null : answer.choice,
    request,
    response,
    elapsedMs,
  };
}
export type PickReceipt = ReturnType<typeof readPick>;

/** Server call shared with the manual evaluation script; null means Jev explicitly chose none. */
export async function producePick(
  input: PickInput,
  config: { apiKey: string; model: string },
): Promise<PickReceipt> {
  if (!config.apiKey) throw new Error("TYPESAFE_API_KEY is required for recording selection");
  const request = pickRequest(input, config.model);
  const started = Date.now();
  const res = await fetch(PICK_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(PICK_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Jev recording selection failed (HTTP ${res.status})`);
  return readPick(request, await res.json(), Date.now() - started);
}
