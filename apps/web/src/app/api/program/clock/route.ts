import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { claude } from "@/lib/claude";
import { env } from "@/lib/env";

/**
 * Practice: can Claude plan a whole program at once? Two calls over a fixed set of songs.
 *
 *   1. the plan   — for each song, what happens at its top (talkup over the intro, a sweeper, a
 *                   clean segue, or a full break) and, from its memory of the record, how long
 *                   the intro runs and the word to hit.
 *   2. the words  — every line of talk for that plan, written in one pass so the hour reads as
 *                   one show: the opening (or a join mid-hour), the talk-ups, the breaks.
 *
 * Nothing is stored; the page prints the rundown. Prompts live here, not in settings.
 */
const Song = z.object({ name: z.string(), artists: z.array(z.string()), durationMs: z.number() });
const Body = z.object({
  /** open: a cold start. join: tuning in mid-hour. top: the top of the hour — the legal ID and the big break. */
  mode: z.enum(["open", "join", "top"]),
  station: z.string(),
  dj: z.string(),
  time: z.string(),
  songs: z.array(Song).min(2).max(20),
  /** What went before, so this part continues it: each earlier slot as one line. */
  previous: z.array(z.string()).optional(),
});
type Input = z.infer<typeof Body>;

type Intro = "talkup" | "sweeper" | "segue" | "break";
interface Plan {
  slots: { song: number; intro: Intro; introMs: number; sure: boolean; post: string; why: string }[];
}
interface Words {
  slots: { song: number; words: string; legalId?: string }[];
}

const PLAN_TOOL: Anthropic.Tool = {
  name: "finish_plan",
  description: "The program's clock: one entry per song, in order.",
  input_schema: {
    type: "object",
    properties: {
      slots: {
        type: "array",
        items: {
          type: "object",
          properties: {
            song: { type: "integer", description: "index into the given song list" },
            intro: {
              type: "string",
              enum: ["talkup", "sweeper", "segue", "break"],
              description:
                "what happens at the top of this song: talkup = the DJ talks over the instrumental intro and hits the post; sweeper = a produced station ID, no DJ; segue = nothing, straight out of the last song; break = the DJ talks over a bed, then leads into this song",
            },
            introMs: {
              type: "integer",
              description:
                "how long the record's instrumental intro runs before the first vocal, from your knowledge of the record; 0 if it starts on the vocal",
            },
            sure: { type: "boolean", description: "whether you are confident about introMs" },
            post: { type: "string", description: "the first sung words — the post to hit; empty if none" },
            why: { type: "string", description: "one line: why this treatment here" },
          },
          required: ["song", "intro", "introMs", "sure", "post", "why"],
        },
      },
    },
    required: ["slots"],
  },
};

const WORDS_TOOL: Anthropic.Tool = {
  name: "finish_words",
  description: "Every line of talk for the plan, in order.",
  input_schema: {
    type: "object",
    properties: {
      slots: {
        type: "array",
        items: {
          type: "object",
          properties: {
            song: { type: "integer" },
            words: {
              type: "string",
              description:
                "what is said at the top of this song: the talk-up, the break, or the sweeper's line; empty for a segue",
            },
            legalId: {
              type: "string",
              description:
                "top-of-the-hour break only: the legal ID said dry before the bed comes in (call letters, city; then the station name as said on air). Empty otherwise.",
            },
          },
          required: ["song", "words"],
        },
      },
    },
    required: ["slots"],
  },
};

const SYSTEM =
  "You are the program director and the DJ of a CHR / Top 40 radio station, 1980s-1990s style: tight, warm, hits-forward, never cheesy. You know the records: their intros, their posts, their tempo, their mood. You speak in short lines meant to be read aloud.";

function planBrief(b: Input) {
  const list = b.songs
    .map((s, i) => `${i}. ${s.artists.join(", ")} - ${s.name} (${Math.round(s.durationMs / 1000)} s)`)
    .join("\n");
  const mode = {
    open: "cold open: the show is starting, the first thing on air is the DJ",
    join: "join: the listener is tuning in mid-hour; we come in on music or a sweeper, the DJ talks at the next natural spot",
    top: "top of the hour: the first slot is the big break — legal ID, time, weather, headlines, what's coming up — then the hour's first song",
  }[b.mode];
  return [
    `Station: ${b.station}. On the mic: ${b.dj}. It is ${b.time}.`,
    `Mode: ${mode}.`,
    ...previously(b),
    "",
    "The set, in order (fixed, do not reorder):",
    list,
    "",
    "Plan the clock. For each song decide what happens at its top. Rules of the format:",
    "- A talkup only over a real instrumental intro (roughly 7 s or more). Never over a record that starts on the vocal or a spoken intro.",
    "- A segue straight out of a fade into a strong start; a sweeper where the energy jumps or a reset is wanted.",
    "- Every 3-4 songs, one break: the DJ talks over a bed for 20-40 s (back-sell what just played, front-sell what's next, the time, a line of personality), then leads into the next song.",
    "- In open mode the first slot is a break (the opening). In join mode the first slot is a sweeper or a segue, never a break. In top mode the first slot is a break (the top of the hour) and the next break comes no sooner than 4 songs later.",
    "Give your best introMs from memory and be honest in `sure`. Call finish_plan.",
  ].join("\n");
}

function previously(b: Input): string[] {
  if (!b.previous?.length) return [];
  return [
    "",
    "Already on air this show, in order (do not repeat these lines or this news; carry on from them):",
    ...b.previous,
  ];
}

function wordsBrief(b: Input, plan: Plan) {
  const list = plan.slots
    .map((p) => {
      const s = b.songs[p.song];
      const talkup =
        p.intro === "talkup"
          ? ` over a ${Math.round(p.introMs / 1000)} s intro, hit the post: "${p.post}"`
          : "";
      return `${p.song}. ${s?.artists.join(", ")} - ${s?.name}\n   at its top: ${p.intro}${talkup}`;
    })
    .join("\n");
  return [
    `Station: ${b.station}. On the mic: ${b.dj}. It is ${b.time}. Mode: ${b.mode}.`,
    ...previously(b),
    "",
    "The clock, as planned:",
    list,
    "",
    "Now write every word that is said, in order, so the hour reads as one show: the DJ remembers what they said and what just played. Rules:",
    "- talkup: one or two lines that fit inside the intro with a beat to spare (about 2.5 words per second), ending right before the post. Name the song or the artist, not both every time.",
    "- sweeper: a produced station-ID line, 3-8 words, not the DJ.",
    "- break: 20-40 s of talk (50-100 words). Back-sell, front-sell, the time, one genuine line. The last line leads into the next song.",
    "- the top-of-the-hour break (top mode, first slot): put the legal ID in `legalId` (dry, on its own), then in `words` 50-70 s (130-180 words): the time, the weather right now and tonight, three headlines — make them up, plausible and local to the station's city, harmless, never real people or real events — one thing coming up this hour, and the last line leads into the song.",
    "- segue: an empty string.",
    "- Say the station's name the way it is said on air. No stage directions, no emojis.",
    "Call finish_words.",
  ].join("\n");
}

async function ask<T>(user: string, tool: Anthropic.Tool): Promise<{ out: T; usage: Anthropic.Usage }> {
  const res = await claude().messages.create({
    model: env().CLAUDE_MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    messages: [{ role: "user", content: user }],
    tools: [tool],
    tool_choice: { type: "tool", name: tool.name },
  });
  const call = res.content.find((c) => c.type === "tool_use");
  if (!call || call.type !== "tool_use") throw new Error(`no ${tool.name} call`);
  return { out: call.input as T, usage: res.usage };
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid body" }, { status: 400 });
  const body = parsed.data;
  try {
    const t0 = Date.now();
    const plan = await ask<Plan>(planBrief(body), PLAN_TOOL);
    const t1 = Date.now();
    const words = await ask<Words>(wordsBrief(body, plan.out), WORDS_TOOL);
    const t2 = Date.now();
    return Response.json({
      plan: plan.out,
      words: words.out,
      timing: { planMs: t1 - t0, wordsMs: t2 - t1 },
      usage: { plan: plan.usage, words: words.usage },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[program clock] failed: ${message}`);
    return Response.json({ error: message }, { status: 502 });
  }
}
