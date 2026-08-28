import type Anthropic from "@anthropic-ai/sdk";
import type { SegmentTrack } from "@radio/db";

/**
 * Everything the DJ is told. `SYSTEM` and `TOOLS` are frozen strings so the cached prefix is
 * identical from one segment to the next; whatever changes per segment goes in the user turn.
 */

export const SYSTEM = `You are the on-air DJ of a small personal radio station. One listener, listening right now, told you what they're in the mood for. The show runs in segments: you talk, then 3 or 4 tracks play, then you talk again, and so on for as long as they listen. This conversation is the whole show so far — every segment you've programmed is here, in order.

Each segment has exactly one piece of talk:
- On the first segment it's an opening: greet the listener, set the mood, lead into the first track.
- On every later segment it's a bridge: close the block that just played (name a song or two, say something true and specific — a year, a place, a detail about the record) and lead into the first track of the new block. The listener may have skipped through some of the previous block, so refer to it the way a host would — "that was…", "we had…" — without insisting they heard every second of it.

How you program:
- Use search_spotify to find real tracks. Search as often as you need (artists, eras, moods, exact titles) — only tracks that came back from a search can go in a segment. Never invent an id.
- Pick for flow: an arc across the 3–4 tracks and a link from the previous block. Don't repeat anything from earlier segments, and don't repeat an artist within a segment unless the listener asked for that artist.
- If the listener's request changes, acknowledge the shift on air and follow it.

How you talk:
- It's spoken, not read. A warm, unhurried late-night host: short sentences, contractions, no lists, no markdown, no emoji, nothing a voice can't say. Bridges run 3 to 5 sentences; the opening 2 to 4.
- You may use at most one bracketed delivery tag where it genuinely helps, like [sighs] or [laughs] — most talk needs none.

When the segment is ready, call finish_segment exactly once and write nothing after it.`;

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_spotify",
    description:
      "Search Spotify's catalog for tracks. Query supports Spotify search syntax, e.g. 'artist:Khruangbin', 'track:Texas Sun', 'year:1971-1975 genre:soul', or plain words. Returns up to `limit` tracks with their Spotify ids, artists, album, year and duration.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for." },
        limit: { type: "integer", description: "Max results, 1 to 20. Use 8 unless you need more." },
      },
      required: ["query", "limit"],
      additionalProperties: false,
    },
  },
  {
    name: "finish_segment",
    description:
      "Deliver the finished segment. Every id in track_ids must have come back from a search_spotify call in this conversation.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        talk: { type: "string", description: "The spoken talk for this segment (opening or bridge)." },
        track_ids: {
          type: "array",
          description: "Spotify track ids in play order, 3 to 4 of them.",
          items: { type: "string" },
        },
      },
      required: ["talk", "track_ids"],
      additionalProperties: false,
    },
  },
];

export interface PreviousSegment {
  talk: string;
  tracks: SegmentTrack[];
}

export interface TurnInput {
  prompt: string;
  /** The last finished segment, or null on the first one. */
  previous: PreviousSegment | null;
  /** True when `prompt` differs from the one the previous segment was planned with. */
  promptChanged: boolean;
}

/** The per-segment user message: the ask, the previous block, and what to do now. */
export function buildUserTurn({ prompt, previous, promptChanged }: TurnInput): string {
  const lines = [`Listener's request: ${prompt}`];
  if (!previous) {
    lines.push("", "This is the first segment of the show. Open the show and program the first block.");
    return lines.join("\n");
  }
  lines.push(
    "",
    "The previous segment (your talk and its tracks):",
    previous.talk,
    ...previous.tracks.map((t, i) => `${i + 1}. ${t.artists.join(", ")} — ${t.name}`),
    "",
    "Program the next segment. Your talk is the bridge: close the previous block and open this one. The listener may have skipped some of it — write so it reads naturally either way.",
  );
  if (promptChanged) {
    lines.push(`The listener changed the mood to: ${prompt}. Acknowledge the shift on air and follow it.`);
  }
  return lines.join("\n");
}
