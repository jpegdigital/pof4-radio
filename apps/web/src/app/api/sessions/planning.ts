import { askJev, readJev } from "../../../lib/jev.ts";
import { prompts } from "../../../lib/prompts/index.ts";
import type { Chart, Hit } from "./doc";
import type { SlotKind } from "./rules";

export const PLANNING_VERSION = "mix-5";
const WORDS_PER_SECOND = 1.8;
const WORDS_MAX = 35;
const TALK_SECONDS = 5;
export interface PlanningInput {
  prompt: string;
  seq: number;
  clockSaysBreak: boolean;
  stationName: string;
  /** Extra words for already selected news and structured weather on a full break. */
  contentWords?: number;
  proposal: { title: string; artist: string; why: string };
  hit: Hit;
  recent: { title: string; artist: string; kind: string; words?: string | null }[];
}
/** Five independent judgments in one request; none refers to another question's answer. */
export function chartRequest(input: PlanningInput, model: string) {
  return { model, state: { hit: input.hit }, questions: prompts.chart.render(input.hit) };
}
/** A typed answer is not evidence of timing accuracy. Preserve the distribution for evaluation. */
export function readChart(request: ReturnType<typeof chartRequest>, raw: unknown, elapsedMs: number) {
  const response = readJev(request, raw);
  const a = response.answers;
  const postTiming = a.post.choice as NonNullable<Chart["postTiming"]>;
  const ending = a.ending.choice;
  const durationMs = request.state.hit.durationMs;
  const chart: Chart = {
    rampMs: postTiming === "beyond_5" ? 5000 : Number(postTiming) * 1000,
    postTiming,
    sure: false,
    post:
      postTiming === "beyond_5"
        ? "Talk-up finish point beyond 5 seconds"
        : "Estimated DJ finish point; not audio-measured",
    outro: ending.startsWith("fade_") ? "fade" : (ending as "cold" | "unknown"),
    outroMs: ending.startsWith("fade_")
      ? Math.max(0, durationMs - Number(ending.slice(5)) * 1000)
      : durationMs,
    energy: Number(a.energy.choice),
    tempo: a.tempo.choice as Chart["tempo"],
    mood: a.mood.choice,
  };
  return { chart, request, response, elapsedMs };
}
export interface MixPlan {
  chart: Chart;
  kind: SlotKind;
  recordUnderMs: number | null;
  voiceInMs: number | null;
  /** Desired overlap duration; actual talk-up length follows the voiced copy. Absent on older plans. */
  talkOverMs?: number;
  /** Exact estimated post relative to song start. The player aligns using the measured voice clip. */
  finishAtMs?: number;
  /** Complete spoken format. Short IDs are fixed before duration is estimated. */
  copyStyle?: "station" | "identify" | "context";
  fixedWords?: string;
  wordsMin?: number;
  wordsMax: number;
  leadWordsMax: number;
  treatment: string;
}
/** Jev chooses a delivery; code aligns its measured clip to the estimated finish point. */
export function mixRequest(input: PlanningInput, estimate: ReturnType<typeof readChart>, model: string) {
  const chart = estimate.chart;
  const options = prompts.mix.options();
  const actions: Record<string, Omit<MixPlan, "chart">> = {};
  const beyond = chart.postTiming === "beyond_5";
  const postMs = beyond ? TALK_SECONDS * 1000 : chart.rampMs;
  const alignment = beyond ? {} : { finishAtMs: postMs };
  const canOverlap = postMs > 0 && postMs < input.hit.durationMs;
  if (input.clockSaysBreak) {
    const base = {
      kind: "break" as const,
      voiceInMs: null,
      wordsMax: WORDS_MAX + (input.contentWords ?? 0),
      leadWordsMax: 8,
    };
    actions.break_dry = { ...base, recordUnderMs: 0, talkOverMs: 0, treatment: options.break_dry };
    if (canOverlap)
      actions.break_post = {
        ...base,
        ...alignment,
        recordUnderMs: postMs,
        talkOverMs: postMs,
        treatment: options.break_post,
      };
  } else {
    actions.segue = {
      kind: "segue",
      recordUnderMs: null,
      voiceInMs: null,
      talkOverMs: 0,
      wordsMax: 0,
      leadWordsMax: 0,
      treatment: options.segue,
    };
    const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    const station = input.stationName.trim();
    if (station && normalize(input.recent.at(-1)?.words ?? "") !== normalize(station)) {
      const words = station.replace(/[.!?]+$/u, "") + ".";
      const count = words.split(/\s+/u).length;
      if (count <= WORDS_MAX) {
        const fixed = {
          copyStyle: "station" as const,
          fixedWords: words,
          wordsMin: count,
          wordsMax: count,
          leadWordsMax: 0,
        };
        actions.sweeper = {
          ...fixed,
          kind: "sweeper",
          recordUnderMs: null,
          voiceInMs: null,
          talkOverMs: 0,
          treatment: options.sweeper,
        };
        if (canOverlap)
          actions.station = {
            ...fixed,
            ...alignment,
            kind: "talkup",
            recordUnderMs: beyond ? postMs : null,
            voiceInMs: 0,
            talkOverMs: postMs,
            treatment: options.station,
          };
      }
    }
    // A short post can carry a fixed station tag; a complete thought needs a few words.
    if (canOverlap && postMs >= 3000)
      actions.talkup = {
        ...alignment,
        kind: "talkup",
        recordUnderMs: beyond ? postMs : null,
        voiceInMs: 0,
        talkOverMs: postMs,
        copyStyle: "context",
        wordsMin: 3,
        wordsMax: Math.floor((postMs / 1000) * WORDS_PER_SECOND),
        leadWordsMax: 0,
        treatment: options.talkup,
      };
  }
  return {
    model,
    state: { ...input, chart, chartJudgments: estimate.response.answers, actions },
    questions: { action: prompts.mix.render(actions) },
  };
}
export function readMix(request: ReturnType<typeof mixRequest>, raw: unknown, elapsedMs: number) {
  const response = readJev(request, raw);
  const action = response.answers.action.choice;
  if (action === "stop") throw new Error("Jev found no suitable mixer action");
  const plan: MixPlan = { chart: request.state.chart, ...request.state.actions[action] };
  return { plan, request, response, elapsedMs };
}
export async function producePlan(input: PlanningInput, config: { apiKey: string; model: string }) {
  const chartReq = chartRequest(input, config.model);
  const call = { apiKey: config.apiKey, what: "mixer planning" };
  const chartAnswer = await askJev(chartReq, call);
  const chart = readChart(chartReq, chartAnswer.raw, chartAnswer.elapsedMs);
  const mixReq = mixRequest(input, chart, config.model);
  const mixAnswer = await askJev(mixReq, call);
  const mix = readMix(mixReq, mixAnswer.raw, mixAnswer.elapsedMs);
  return {
    version: PLANNING_VERSION,
    plan: mix.plan,
    chart,
    mix,
    elapsedMs: chart.elapsedMs + mix.elapsedMs,
  };
}
export type PlanningReceipt = Awaited<ReturnType<typeof producePlan>>;
