import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { claude } from "@/lib/claude";
import { env } from "@/lib/env";
import type { Identity } from "@/lib/identity";
import type { Hit } from "./doc";
import { RULES_TEXT } from "./rules";
import { Written } from "./shapes";

/**
 * One call writes one slot: which of the slot's hits plays (the pick), what the writer knows of
 * that version (the chart), what is said over it (the copy: a kind, the words, the break's lead
 * line, why) and the two numbers the mix follows (the timing). The brief carries the ask, the
 * clock, the station, the DJ, this slot's proposal and its hits as a menu, the last slots' copy,
 * everything played, another DJ's chart of any hit when one exists, and — for a break only — the
 * legal ID when due, the weather and the headlines. The clock's word on the kind goes in the
 * brief and is enforced after (rules.ts). A refusal or a pick outside the hits gets one more try;
 * nothing usable twice is null, and the caller makes the slot a segue. Pure production: no
 * database in here; the caller owns the row.
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

/** Another session's chart of one of this slot's hits, with what was said over it. */
export interface PriorChart {
  id: string;
  title: string;
  artists: string[];
  rampMs: number;
  sure: boolean;
  post: string;
  outro: string;
  outroMs: number;
  energy: number;
  tempo: string;
  mood: string;
  words: string | null;
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
  hits: Hit[];
  /** The last few written slots before this one, in show order. */
  recent: RecentSlot[];
  /** Everything written before this one, in show order. */
  played: { title: string; artist: string }[];
  priorCharts: PriorChart[];
  /** The legal ID to open with, or null when it is not due (or this is not a break). */
  legalId: string | null;
  /** The weather as the brief carries it (`weatherText`), or null: then nothing is said of it. */
  weather: string | null;
  /** The headlines as the brief carries them (`headlinesText`), or null: then none are said. */
  headlines: string | null;
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

/** One headline in the break, a single spoken sentence. The DJ picks what sits with the music. */
export const headlinesBlock = (headlines: string) =>
  [
    "The headlines right now, from Google News (the city's, then the nation's, then the world's), each with its source:",
    headlines,
    'Say one of them in the break, two at most, each a single spoken sentence: the gist, in your own words, and the source when it matters ("the Morning News says…"). Pick what sits with the music and the hour; leave the rest unsaid. Nothing grim straight into a love song.',
  ].join("\n");

const recentLine = (r: RecentSlot) => {
  const said = [r.words, r.leadLine].filter(Boolean).join(" ");
  return `${r.seq}. ${r.artist} — ${r.title}: ${r.kind}${said ? ` — "${said}"` : " (nothing said)"}`;
};

const chartLine = (c: PriorChart) =>
  `Another DJ's read of ${c.id} (${c.artists.join(", ")} — ${c.title}): ramp ${Math.round(c.rampMs / 1000)} s (${c.sure ? "sure" : "unsure"}); the vocal comes in on ${c.post || "nothing"}; ends ${c.outro} at ${mmss(c.outroMs)}; energy ${c.energy}/5, ${c.tempo}-tempo; ${c.mood}.${c.words ? ` They said: "${c.words}"` : ""}`;

/** The brief the writer gets for this one slot. */
export function writeBrief(input: WriteInput): string {
  const { proposal, hits, recent, played, priorCharts, clockSaysBreak, legalId } = input;
  const menu = hits
    .map((h) => `   ${h.id} | ${h.title} — ${h.artists.join(", ")} | ${h.album} | ${mmss(h.durationMs)}`)
    .join("\n");
  const before = recent.length
    ? [`The last slots, what was said there:`, ...recent.map(recentLine), ""]
    : [`This is the first slot of the show: nothing has played yet.`, ""];
  const soFar = played.length
    ? [`Played so far, in order:`, ...played.map((p) => `- ${p.artist} — ${p.title}`), ""]
    : [];
  const charts = priorCharts.length
    ? [
        `Notes from earlier shows (read-only, another DJ's ear; trust your own):`,
        ...priorCharts.map(chartLine),
        "",
      ]
    : [];
  const slot = clockSaysBreak
    ? [
        `Slot ${input.seq}: this slot is the break. The DJ over a bed, then the lead line into the song — set up what is happening for the listener, then talk the song in.`,
        legalId
          ? `The legal ID "${legalId}" is said first, dry, before the bed comes in. It is added for you — do not write it into your words.`
          : "No legal ID on this break: it was said this hour already.",
      ]
    : [
        `Slot ${input.seq}: this slot is not a break. Choose how the song is brought on air — a talk-up over its ramp, a sweeper, or a segue — and write every word said there.`,
      ];
  return [
    `The listener's request: ${input.prompt}`,
    `The clock: ${input.clock}`,
    "",
    ...before,
    ...soFar,
    `This slot's song: ${proposal.artist} — ${proposal.title}. Why it is here: ${proposal.why}`,
    "The catalogue has these versions of it. Pick the one to play: the single or the original album cut unless the request wants a live take or a remix — never a remix, a cover, a karaoke, a sped-up or a tribute version by mistake; read the artist and the album, not just the title.",
    menu,
    "",
    ...charts,
    ...slot,
    "Chart the version you picked from what you know of it: the ramp before the first vocal (and whether you are sure of it), where the vocal lands, how it ends, the feel.",
    "",
    ...(clockSaysBreak && input.weather ? [weatherBlock(input.identity.city, input.weather), ""] : []),
    ...(clockSaysBreak && input.headlines ? [headlinesBlock(input.headlines), ""] : []),
    RULES_TEXT,
  ].join("\n");
}

/** The model's reasoning, when the answer carries any. */
const thinkingOf = (content: { type: string; thinking?: string }[]) =>
  content
    .filter((b): b is { type: "thinking"; thinking: string } => b.type === "thinking")
    .map((b) => b.thinking)
    .join("\n\n");

export async function produceWrite(
  input: WriteInput,
): Promise<{ written: Written; thinking: string } | null> {
  const brief = writeBrief(input);
  const ids = new Set(input.hits.map((h) => h.id));
  const once = () =>
    claude().messages.parse({
      model: env().CLAUDE_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: zodOutputFormat(Written) },
      system: system(input.dj, input.identity),
      messages: [{ role: "user", content: brief }],
    });
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await once();
    const w = res.parsed_output;
    if (!w) {
      console.warn(
        `[sessions] slot ${input.seq}: the writer gave nothing (${res.stop_reason}), attempt ${attempt}`,
      );
      continue;
    }
    if (!ids.has(w.pick)) {
      console.warn(
        `[sessions] slot ${input.seq}: the writer picked ${w.pick}, not one of the hits, attempt ${attempt}`,
      );
      continue;
    }
    return { written: w, thinking: thinkingOf(res.content) };
  }
  return null;
}
