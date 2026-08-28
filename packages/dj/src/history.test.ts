import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { capHistory, trimTurn, withCache } from "./history.ts";

type Msg = Anthropic.MessageParam;

const turn: Msg[] = [
  { role: "user", content: "Listener's request: soul" },
  {
    role: "assistant",
    content: [
      { type: "text", text: "Let me look." },
      { type: "tool_use", id: "s1", name: "search_spotify", input: { query: "al green", limit: 8 } },
    ],
  },
  { role: "user", content: [{ type: "tool_result", tool_use_id: "s1", content: "Al Green — … id=x" }] },
  {
    role: "assistant",
    content: [
      { type: "tool_use", id: "f1", name: "finish_segment", input: { talk: "Hey.", track_ids: ["x"] } },
    ],
  },
  { role: "user", content: [{ type: "tool_result", tool_use_id: "f1", content: "Segment accepted." }] },
];

describe("trimTurn", () => {
  it("keeps only the request and the accepted finish call", () => {
    const t = trimTurn(turn);
    expect(t).toHaveLength(3);
    expect(t[0]).toEqual({ role: "user", content: "Listener's request: soul" });
    expect(t[1]?.content).toEqual([
      { type: "tool_use", id: "f1", name: "finish_segment", input: { talk: "Hey.", track_ids: ["x"] } },
    ]);
    expect(t[2]?.content).toEqual([{ type: "tool_result", tool_use_id: "f1", content: "Segment accepted." }]);
  });

  it("throws when the turn never finished", () => {
    expect(() => trimTurn(turn.slice(0, 3))).toThrow(/finish_segment/);
  });
});

describe("capHistory", () => {
  const msgs = (n: number): Msg[] =>
    Array.from({ length: n }, (_, i) => ({ role: "user", content: `m${i}` }));

  it("leaves short histories alone", () => {
    expect(capHistory(msgs(6), 20)).toHaveLength(6);
  });

  it("drops the oldest whole turns", () => {
    const out = capHistory(msgs(9), 2);
    expect(out).toHaveLength(6);
    expect(out[0]?.content).toBe("m3");
  });
});

describe("withCache", () => {
  it("marks only the last block of the last message, removing older markers", () => {
    const input: Msg[] = [
      { role: "user", content: [{ type: "text", text: "a", cache_control: { type: "ephemeral" } }] },
      { role: "assistant", content: "b" },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "ok" }] },
    ];
    const out = withCache(input);
    expect(out[0]?.content).toEqual([{ type: "text", text: "a" }]);
    expect(out[1]?.content).toEqual([{ type: "text", text: "b" }]);
    expect(out[2]?.content).toEqual([
      {
        type: "tool_result",
        tool_use_id: "x",
        content: "ok",
        cache_control: { type: "ephemeral", ttl: "1h" },
      },
    ]);
    expect(input[2]?.content).toEqual([{ type: "tool_result", tool_use_id: "x", content: "ok" }]); // untouched
  });
});
