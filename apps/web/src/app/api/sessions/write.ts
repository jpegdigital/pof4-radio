import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { claude } from "@/lib/claude";
import { env } from "@/lib/env";
import type { Identity } from "@/lib/identity";
import type { Hit } from "./doc";
import type { MixPlan } from "./planning";
import { Written } from "./shapes";

/**
 * Claude writes prose for Jev’s fixed recording and mixer plan. It has no planning choices
 * in its input or output. A failed/refused write fails the request; no substitute is made.
 * The caller owns the row and applies the clock's rules after writing.
 */

// Inline for now, like the fill's; moves to the settings table when the prompts start being tuned.
export const system = (dj: string | null, identity: Identity) =>
  `You are ${dj ? `${dj}, ` : ""}the DJ on ${identity.onAir} (${identity.calls}, ${identity.city}). You write what is said on air, exactly as it will be voiced: spoken, not read — short sentences, contractions, no lists, no headers, no stage directions, no lyrics. Tight: one detail about a song, two at most, never three. You talk about the songs and the listener's ask, not about yourself.`;

export const legalIdOf = (i: Identity) => `${i.calls}, ${i.city}. ${i.onAir}.`;

/** "8:43 pm" from ms since midnight — the clock as the brief says it. */
export function clockOf(ms: number): string {
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  return `${h % 12 || 12}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** A slot already written in this show: what was said there. */
export interface RecentSlot {
  seq: number;
  kind: string;
  words: string | null;
  leadLine: string | null;
  title: string;
  artist: string;
}

export interface WriteInput {
  prompt: string;
  dj: string | null;
  identity: Identity;
  /** "8:43 pm". */
  clock: string;
  seq: number;
  clockSaysBreak: boolean;
  proposal: { title: string; artist: string; why: string };
  /** The recording Jev selected. The writer cannot replace it. */
  hit: Hit;
  /** The last few written slots before this one, in show order. */
  recent: RecentSlot[];
  /** Everything written before this one, in show order. */
  played: { title: string; artist: string }[];
  /** Fixed Jev chart, mixer action, and spoken word budgets. */
  plan: MixPlan;
  /** The legal ID to open with, or null when it is not due (or this is not a break). */
  legalId: string | null;
  /** The weather as the brief carries it (`weatherText`), or null: then nothing is said of it. */
  weather: string | null;
  /** The editor's checked sentence is composed outside this writer, never paraphrased here. */
  newsReserved: boolean;
}

const mmss = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

/**
 * The weather goes in the break and nowhere else, in one breath: now, then today and tonight,
 * the way it rolls off the tongue. The feed's prose is long; the DJ is told to cut it.
 */
export const weatherBlock = (city: string, weather: string) =>
  [
    `The weather in ${city} right now, from the National Weather Service:`,
    weather,
    'Say it in the break, in one breath, the way it rolls off the tongue: what it is now, then today and tonight — "eighty-one and cloudy, storms around lunch, down to seventy-six tonight". Two sentences at most. Skip the humidity, the wind and the rain totals unless one of them is the story.',
  ].join("\n");

const recentLine = (r: RecentSlot) => {
  const said = [r.words, r.leadLine].filter(Boolean).join(" ");
  return `${r.seq}. ${r.artist} — ${r.title}: ${r.kind}${said ? ` — "${said}"` : " (nothing said)"}`;
};

/** The brief the writer gets for this one slot. */
export function writeBrief(input: WriteInput): string {
  const { proposal, hit, recent, played, plan, clockSaysBreak, legalId } = input;
  const recording = `${hit.id} | ${hit.title} — ${hit.artists.join(", ")} | ${hit.album} | ${mmss(hit.durationMs)}`;
  const before = recent.length
    ? [`The last slots, what was said there:`, ...recent.map(recentLine), ""]
    : [`This is the first slot of the show: nothing has played yet.`, ""];
  const soFar = played.length
    ? [`Played so far, in order:`, ...played.map((p) => `- ${p.artist} — ${p.title}`), ""]
    : [];
  const slot = clockSaysBreak
    ? [
        `Slot ${input.seq}: this slot is the break. The DJ over a bed, then the lead line into the song — set up what is happening for the listener, then talk the song in.`,
        legalId
          ? `The legal ID "${legalId}" is said first, dry, before the bed comes in. It is added for you — do not write it into your words.`
          : "No legal ID on this break: it was said this hour already.",
      ]
    : [`Slot ${input.seq}: this slot is not a break. Write only the copy for the supplied Jev plan.`];
  return [
    `The listener's request: ${input.prompt}`,
    `The clock: ${input.clock}`,
    "",
    ...before,
    ...soFar,
    `This slot's song: ${proposal.artist} — ${proposal.title}. Why it is here: ${proposal.why}`,
    "The recording is fixed. Write only for this recording; do not choose or substitute another version.",
    recording,
    "",
    "Jev has fixed the chart and mixer plan. Do not revise it or infer different timings.",
    JSON.stringify(plan),
    ...slot,
    "Write at most " +
      plan.wordsMax +
      " words in words and at most " +
      plan.leadWordsMax +
      " words in leadLine. Aim below these caps. Empty leadLine except on a break.",
    ...(plan.kind === "talkup" && plan.talkOverMs !== undefined
      ? [
          "The DJ has approximately " +
            plan.talkOverMs / 1000 +
            " seconds over the music. Write one complete thought at a natural speaking pace, with the song or artist woven in. A bare title, surname or generic exclamation is not an introduction. Use one specific connection to the listener's show; do not invent facts or substitute a station tag. Do not pad, rush, or truncate names to fit a stopwatch. The vocal estimate is guidance; the supplied plan may intentionally cross an opening word.",
        ]
      : []),
    ...(plan.wordsMin !== undefined
      ? [
          "Use at least " +
            plan.wordsMin +
            " words for the complete planned introduction, within the maximum above.",
        ]
      : []),
    "",
    ...(clockSaysBreak && input.weather ? [weatherBlock(input.identity.city, input.weather), ""] : []),
    "Do not write news or current-event claims, even from the listener request or earlier copy. The news editor owns those words.",
    ...(clockSaysBreak && input.newsReserved
      ? [
          "A checked news sentence is inserted before your words. Keep your music/weather portion within the supplied word budget and use a neutral transition. Do not repeat or refer back to the news.",
          "",
        ]
      : []),
    "Never quote lyrics. Do not include the legal ID; it is added for you. Return only the spoken copy, with no stage directions, timing numbers, or analysis.",
  ].join("\n");
}

/** The model's reasoning, when the answer carries any. */
const thinkingOf = (content: { type: string; thinking?: string }[]) =>
  content
    .filter((b): b is { type: "thinking"; thinking: string } => b.type === "thinking")
    .map((b) => b.thinking)
    .join("\n\n");

export async function produceWrite(input: WriteInput): Promise<{ written: Written; thinking: string }> {
  if (input.plan.fixedWords !== undefined)
    return { written: { words: input.plan.fixedWords, leadLine: "" }, thinking: "" };
  const res = await claude().messages.parse({
    model: env().CLAUDE_MODEL,
    max_tokens: 2048,
    thinking: { type: "disabled" },
    output_config: { format: zodOutputFormat(Written) },
    system: system(input.dj, input.identity),
    messages: [{ role: "user", content: writeBrief(input) }],
  });
  if (!res.parsed_output)
    throw new Error(`slot ${input.seq}: Claude returned no usable copy (${res.stop_reason})`);
  return { written: Written.parse(res.parsed_output), thinking: thinkingOf(res.content) };
}
