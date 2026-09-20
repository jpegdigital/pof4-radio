import { z } from "zod";
import type { ChoiceQuestion } from "./prompts/contract.ts";

/**
 * Jev, the station's judge: TypeSafe's System One answering choice questions over a state. One
 * POST (`askJev`) and one reading (`readJev`) for every judgment the show asks of it — the
 * recording, the chart, the mixer action, the headlines. What a question means and what its
 * answer becomes stay with the caller; this file owns the wire and the law every answer is held
 * to. No retries and no second opinion: a failed judgment stops the slot. The key is handed in,
 * never read from env here, so the eval scripts run this under plain `node`.
 */

const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const JEV_TIMEOUT_MS = 15_000;
/** TypeSafe rounds each probability to 0.01, so every term may be off by half that unit. */
const ROUNDING_PER_OPTION = 0.005;
const FLOAT_SLACK = 0.000001;
const ERROR_BODY_MAX = 200;

/** A Jev call or answer that cannot be used. `status` is the HTTP status when the call itself failed. */
export class JevError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "JevError";
    this.status = status;
  }
}

/** The exact body sent, retained by callers so a judgment can be inspected and replayed. */
export interface JevRequest<Q extends string = string> {
  model: string;
  state: unknown;
  questions: Record<Q, ChoiceQuestion>;
}

const probability = z.number().min(0).max(1);
const Answer = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  confidence: probability,
  probabilities: z.record(z.string(), probability),
});
const Reply = z.object({
  model: z.string().min(1),
  answers: z.record(z.string(), Answer),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
});
export type JevAnswer = z.infer<typeof Answer>;
export interface JevResponse<Q extends string = string> {
  model: string;
  answers: Record<Q, JevAnswer>;
  usage: z.infer<typeof Reply>["usage"];
}

/**
 * Hold a raw answer to the request that was sent: the same model, one answer per question and no
 * others, each choice and each probability on that question's menu, the distribution summing to
 * one within what rounding allows. The declared choice is authoritative and confidence is never
 * a gate; the probabilities are kept as given, for evaluation.
 */
export function readJev<Q extends string>(request: JevRequest<Q>, raw: unknown): JevResponse<Q> {
  const parsed = Reply.safeParse(raw);
  if (!parsed.success) throw new JevError(`Invalid Jev response: ${z.prettifyError(parsed.error)}`);
  const response = parsed.data;
  if (response.model !== request.model)
    throw new JevError(`Invalid Jev model: asked ${request.model}, answered ${response.model}`);
  const ids = Object.keys(request.questions) as Q[];
  if (Object.keys(response.answers).length !== ids.length || ids.some((id) => !response.answers[id]))
    throw new JevError("Invalid Jev answers: they do not match the questions asked");
  for (const id of ids) {
    const answer = response.answers[id];
    const options = Object.keys(request.questions[id].criteria);
    const entries = Object.entries(answer.probabilities);
    if (
      !options.includes(answer.choice) ||
      entries.length !== options.length ||
      entries.some(([option]) => !options.includes(option))
    )
      throw new JevError(`Invalid Jev choice or options outside the menu: ${id}`);
    const sum = entries.reduce((total, [, p]) => total + p, 0);
    if (sum <= 0 || Math.abs(sum - 1) > entries.length * ROUNDING_PER_OPTION + FLOAT_SLACK)
      throw new JevError(`Invalid Jev distribution: ${id} sums to ${sum}`);
  }
  return response as JevResponse<Q>;
}

export interface JevCall {
  apiKey: string;
  /** What is being judged, for the error: "recording selection". */
  what: string;
  /** A judgment over a long menu may be given longer than the default. */
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

/** One POST, timed. The answer comes back unread: `readJev` is what makes it usable. */
export async function askJev(
  request: JevRequest,
  call: JevCall,
): Promise<{ raw: unknown; elapsedMs: number }> {
  if (!call.apiKey) throw new JevError(`TYPESAFE_API_KEY is required for ${call.what}`);
  const started = Date.now();
  const res = await (call.fetchFn ?? fetch)(JEV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${call.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(call.timeoutMs ?? JEV_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, ERROR_BODY_MAX);
    throw new JevError(`Jev ${call.what} failed (HTTP ${res.status}): ${body}`, res.status);
  }
  const raw: unknown = await res.json();
  return { raw, elapsedMs: Date.now() - started };
}
