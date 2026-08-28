import type Anthropic from "@anthropic-ai/sdk";

/**
 * Keeping the conversation cheap.
 *
 * A segment's turn, as it happens, is the request plus a handful of search calls and their
 * track listings — a few thousand tokens. Once the segment is accepted only the decision
 * matters, so the turn is stored as three messages: request → finish_segment call → result.
 * The DJ still sees exactly what it said and played in every earlier segment.
 */

export const MESSAGES_PER_SEGMENT = 3;
export const DEFAULT_MAX_SEGMENTS = 20;

type Msg = Anthropic.MessageParam;

const isToolUse = (b: Anthropic.ContentBlockParam): b is Anthropic.ToolUseBlockParam => b.type === "tool_use";

/**
 * Reduce a finished turn (the messages appended during one `planSegment`) to its three-message
 * form. `turn[0]` must be the user request; the accepted `finish_segment` call is the last one
 * in the turn.
 */
export function trimTurn(turn: Msg[]): Msg[] {
  const request = turn[0];
  if (!request || request.role !== "user") throw new Error("turn must start with the user request");
  let finish: Anthropic.ToolUseBlockParam | undefined;
  for (const m of turn) {
    if (m.role !== "assistant" || typeof m.content === "string") continue;
    for (const b of m.content) if (isToolUse(b) && b.name === "finish_segment") finish = b;
  }
  if (!finish) throw new Error("turn has no finish_segment call");
  return [
    { role: "user", content: contentText(request) },
    {
      role: "assistant",
      content: [{ type: "tool_use", id: finish.id, name: finish.name, input: finish.input }],
    },
    {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: finish.id, content: "Segment accepted." }],
    },
  ];
}

/** Keep the last `maxSegments` turns (whole turns only, from the end). */
export function capHistory(messages: Msg[], maxSegments = DEFAULT_MAX_SEGMENTS): Msg[] {
  const keep = maxSegments * MESSAGES_PER_SEGMENT;
  if (messages.length <= keep) return messages;
  const dropped = messages.length - keep;
  // Drop whole turns: round `dropped` up to a multiple of the turn size.
  const start = Math.ceil(dropped / MESSAGES_PER_SEGMENT) * MESSAGES_PER_SEGMENT;
  return messages.slice(start);
}

/**
 * The request's cache breakpoint: one marker, on the last block of the last message, with a
 * 1-hour TTL (segments are ~15 minutes apart; the default 5-minute cache would miss every time).
 * Any marker left from an earlier request is removed so the prefix stays byte-identical.
 */
export function withCache(messages: Msg[]): Msg[] {
  const out = messages.map((m): Msg => {
    if (typeof m.content === "string") return { role: m.role, content: [{ type: "text", text: m.content }] };
    return { role: m.role, content: m.content.map(stripCache) };
  });
  const last = out.at(-1);
  if (!last || typeof last.content === "string") return out;
  const blocks = last.content;
  const tail = blocks.at(-1);
  if (tail) {
    blocks[blocks.length - 1] = {
      ...tail,
      cache_control: { type: "ephemeral", ttl: "1h" },
    } as Anthropic.ContentBlockParam;
  }
  return out;
}

function stripCache(b: Anthropic.ContentBlockParam): Anthropic.ContentBlockParam {
  if (!("cache_control" in b)) return b;
  const { cache_control: _drop, ...rest } = b;
  return rest;
}

function contentText(m: Msg): string {
  if (typeof m.content === "string") return m.content;
  return m.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .filter(Boolean)
    .join("\n");
}
