import { prompts } from "../../../lib/prompts/index.ts";
import type { ChoiceQuestion } from "../../../lib/prompts/contract.ts";
import { z } from "zod";
import type { Chart, Hit } from "./doc";
import type { SlotKind } from "./rules";

export const PLANNING_VERSION = "mix-3";
const URL = "https://api.typesafe.ai/v1/systemone";
const TIMEOUT_MS = 15000;
const INTRO_SECONDS = [0, 1, 5, 10, 20, 30, 45, 60, 90, 120];
const WORDS_PER_SECOND = 1.8;
const WORDS_MAX = 35;
// Break overlap is independent of copy length: most of the break precedes the track.
const TALK_SECONDS = Array.from({ length: Math.ceil(WORDS_MAX / WORDS_PER_SECOND) }, (_, i) => i + 1);
const VOICE_START_SECONDS = [0, 1, 2, 3];
const TALKUP_MIN_SECONDS = 2;
const CONTEXT_SECONDS = 8;
const CONTEXT_WORDS_MIN = 6;
const SPEECH_CHARS_PER_SECOND = 14;
const PHRASE_PAUSE_SECONDS = 0.25;
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
interface Request {
  model: string;
  state: unknown;
  questions: Record<string, ChoiceQuestion>;
}
const probability = z.number().min(0).max(1);
const Response = z.object({
  model: z.string(),
  answers: z.record(
    z.string(),
    z.object({
      type: z.literal("choice"),
      choice: z.string(),
      confidence: probability,
      probabilities: z.record(z.string(), probability),
    }),
  ),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
});
/** A typed answer is not evidence of timing accuracy. Preserve the distribution for evaluation. */
function read(request: Request, raw: unknown) {
  const response = Response.parse(raw);
  if (response.model !== request.model) throw new Error("Invalid Jev planning model");
  const ids = Object.keys(request.questions);
  if (Object.keys(response.answers).length !== ids.length || ids.some((id) => !response.answers[id]))
    throw new Error("Invalid Jev planning answers");
  for (const id of ids) {
    const answer = response.answers[id];
    const options = Object.keys(request.questions[id].criteria);
    const entries = Object.entries(answer.probabilities);
    if (
      !options.includes(answer.choice) ||
      entries.length !== options.length ||
      entries.some(([key]) => !options.includes(key))
    )
      throw new Error("Invalid Jev planning choice: " + id);
    // The API rounds probabilities to 0.01; each term may be off by half that unit.
    // Jev's explicit choice is authoritative; reported probabilities are audit data.
    const sum = entries.reduce((total, [, p]) => total + p, 0);
    if (sum <= 0 || Math.abs(sum - 1) > entries.length * 0.005 + 0.000001)
      throw new Error("Invalid Jev planning distribution: " + id + " " + JSON.stringify(answer));
  }
  return response;
}

/** Five independent judgments in one request; none refers to another question's answer. */
export function chartRequest(input: PlanningInput, model: string) {
  return { model, state: { hit: input.hit }, questions: prompts.chart.render(input.hit, INTRO_SECONDS) };
}
export function readChart(request: ReturnType<typeof chartRequest>, raw: unknown, elapsedMs: number) {
  const response = read(request, raw);
  const a = response.answers;
  const intro = a.intro.choice;
  const ending = a.ending.choice;
  const durationMs = request.state.hit.durationMs;
  const chart: Chart = {
    rampMs: intro === "unknown" ? 0 : intro === "instrumental" ? durationMs : Number(intro) * 1000,
    sure: false,
    post:
      intro === "unknown"
        ? "Intro unknown"
        : intro === "instrumental"
          ? "Instrumental; no vocal"
          : "Estimated first-vocal lower bound; not audio-measured",
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
  /** Complete spoken format. Short IDs are fixed before duration is estimated. */
  copyStyle?: "station" | "identify" | "context";
  fixedWords?: string;
  wordsMin?: number;
  wordsMax: number;
  leadWordsMax: number;
  treatment: string;
}
/** Vocal estimates inform taste, not eligibility. Code owns durations and copy budgets. */
export function mixRequest(input: PlanningInput, estimate: ReturnType<typeof readChart>, model: string) {
  const chart = estimate.chart;
  const actions: Record<string, Omit<MixPlan, "chart">> = {};
  if (input.clockSaysBreak) {
    actions.break_dry = {
      kind: "break",
      recordUnderMs: 0,
      voiceInMs: null,
      talkOverMs: 0,
      wordsMax: WORDS_MAX + (input.contentWords ?? 0),
      leadWordsMax: 8,
      treatment: prompts.mix.copy.breakDry,
    };
    for (const seconds of TALK_SECONDS) {
      if (seconds * 1000 < input.hit.durationMs)
        actions["break_under_" + seconds] = {
          kind: "break",
          recordUnderMs: seconds * 1000,
          voiceInMs: null,
          talkOverMs: seconds * 1000,
          wordsMax: WORDS_MAX + (input.contentWords ?? 0),
          leadWordsMax: 8,
          treatment: prompts.mix.copy.breakUnder(seconds),
        };
    }
  } else {
    actions.segue = {
      kind: "segue",
      recordUnderMs: null,
      voiceInMs: null,
      talkOverMs: 0,
      wordsMax: 0,
      leadWordsMax: 0,
      treatment: prompts.mix.copy.segue,
    };
    const formats: {
      copyStyle: NonNullable<MixPlan["copyStyle"]>;
      fixedWords?: string;
      wordsMin: number;
      wordsMax: number;
      seconds: number;
      description: string;
    }[] = [];
    const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    const fixed = [
      { copyStyle: "station" as const, text: input.stationName.trim() },
      {
        copyStyle: "identify" as const,
        text: input.proposal.title.trim() + ", " + input.proposal.artist.trim(),
      },
    ];
    for (const { copyStyle, text } of fixed) {
      if (!text) continue;
      if (copyStyle === "station" && normalize(input.recent.at(-1)?.words ?? "") === normalize(text))
        continue;
      const words = text.replace(/[.!?]+$/u, "") + ".";
      const count = words.split(/\s+/u).length;
      // Frequencies and numbers take multiple spoken words; long names also need breathing room.
      const spokenUnits = words
        .replace(/\d+(?:\.\d+)?/gu, (n) =>
          " number".repeat(n.replace(/\D/gu, "").length + (n.includes(".") ? 1 : 0)),
        )
        .trim()
        .split(/\s+/u).length;
      const seconds = Math.max(
        TALKUP_MIN_SECONDS,
        Math.ceil(
          Math.max(spokenUnits / WORDS_PER_SECOND, words.length / SPEECH_CHARS_PER_SECOND) +
            PHRASE_PAUSE_SECONDS,
        ),
      );
      if (count > WORDS_MAX || seconds > TALK_SECONDS.length) continue;
      formats.push({
        copyStyle,
        fixedWords: words,
        wordsMin: count,
        wordsMax: count,
        seconds,
        description: prompts.mix.copy.identify(copyStyle, words),
      });
    }
    formats.push({
      copyStyle: "context",
      wordsMin: CONTEXT_WORDS_MIN,
      wordsMax: Math.floor(CONTEXT_SECONDS * WORDS_PER_SECOND),
      seconds: CONTEXT_SECONDS,
      description: prompts.mix.copy.context,
    });
    const station = formats.find((format) => format.copyStyle === "station");
    if (station)
      actions.sweeper = {
        kind: "sweeper",
        recordUnderMs: null,
        voiceInMs: null,
        talkOverMs: 0,
        copyStyle: "station",
        fixedWords: station.fixedWords,
        wordsMin: station.wordsMin,
        wordsMax: station.wordsMax,
        leadWordsMax: 0,
        treatment: prompts.mix.copy.sweeper(station.description),
      };
    for (const start of VOICE_START_SECONDS)
      for (const format of formats) {
        if ((start + format.seconds) * 1000 >= input.hit.durationMs) continue;
        actions["talkup_" + format.copyStyle + "_after_" + start] = {
          kind: "talkup",
          recordUnderMs: null,
          voiceInMs: start * 1000,
          talkOverMs: format.seconds * 1000,
          copyStyle: format.copyStyle,
          fixedWords: format.fixedWords,
          wordsMin: format.wordsMin,
          wordsMax: format.wordsMax,
          leadWordsMax: 0,
          treatment: prompts.mix.copy.talkup(format.description, start, format.seconds),
        };
      }
  }
  return {
    model,
    state: { ...input, chart, chartJudgments: estimate.response.answers, actions },
    questions: {
      action: prompts.mix.render(actions),
    },
  };
}
export function readMix(request: ReturnType<typeof mixRequest>, raw: unknown, elapsedMs: number) {
  const response = read(request, raw);
  const action = response.answers.action.choice;
  if (action === "stop") throw new Error("Jev found no suitable mixer action");
  const plan: MixPlan = { chart: request.state.chart, ...request.state.actions[action] };
  return { plan, request, response, elapsedMs };
}
async function ask(request: Request, apiKey: string) {
  if (!apiKey) throw new Error("TYPESAFE_API_KEY is required for mixer planning");
  const started = Date.now();
  const response = await fetch(URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Jev mixer planning failed (HTTP " + response.status + ")");
  const raw: unknown = await response.json();
  return { raw, elapsedMs: Date.now() - started };
}
export async function producePlan(input: PlanningInput, config: { apiKey: string; model: string }) {
  const chartReq = chartRequest(input, config.model);
  const chartAnswer = await ask(chartReq, config.apiKey);
  const chart = readChart(chartReq, chartAnswer.raw, chartAnswer.elapsedMs);
  const mixReq = mixRequest(input, chart, config.model);
  const mixAnswer = await ask(mixReq, config.apiKey);
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
