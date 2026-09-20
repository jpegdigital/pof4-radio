import { askJev, readJev } from "../../../lib/jev.ts";
import { prompts } from "../../../lib/prompts/index.ts";
import { z } from "zod";

/** One recording decision. No retries, substitute recording, or second decision maker. */
export const PICK_MODEL = "jev-1.13.0";
export const PICK_VERSION = "recording-1";
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

/** Jev's explicit choice is the pick; the distribution is retained for evaluation. */
export function readPick(request: PickRequest, raw: unknown, elapsedMs: number) {
  const response = readJev(request, raw);
  const choice = response.answers.pick.choice;
  return {
    version: PICK_VERSION,
    pick: choice === NONE ? null : choice,
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
  const request = pickRequest(input, config.model);
  const { raw, elapsedMs } = await askJev(request, { apiKey: config.apiKey, what: "recording selection" });
  return readPick(request, raw, elapsedMs);
}
