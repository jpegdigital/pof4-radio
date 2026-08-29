import type { Track } from "@radio/spotify";
import { describe, expect, it } from "vitest";
import { describeTurn, planSegment, resolveFinish } from "./dj.ts";

const track = (id: string): Track => ({
  id,
  uri: `spotify:track:${id}`,
  name: `Song ${id}`,
  artists: ["Someone"],
  album: "Album",
  images: [],
  durationMs: 200_000,
  explicit: false,
  releaseDate: "1999-01-01",
});

const seen = new Map([
  ["a", track("a")],
  ["b", track("b")],
  ["c", track("c")],
  ["d", track("d")],
  ["e", track("e")],
]);

describe("resolveFinish", () => {
  it("resolves ids the DJ saw, in order", () => {
    const r = resolveFinish({ talk: "hi", track_ids: ["c", "a", "b"] }, seen);
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.tracks.map((t) => t.uri)).toEqual(["spotify:track:c", "spotify:track:a", "spotify:track:b"]);
  });

  it("rejects an id that never came back from search", () => {
    const r = resolveFinish({ talk: "hi", track_ids: ["a", "zzz", "b"] }, seen);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toContain("zzz");
  });

  it("rejects the wrong count, duplicates and empty talk", () => {
    expect(resolveFinish({ talk: "hi", track_ids: ["a", "b"] }, seen).ok).toBe(false);
    expect(resolveFinish({ talk: "hi", track_ids: ["a", "b", "c", "d", "e"] }, seen).ok).toBe(false);
    expect(resolveFinish({ talk: "hi", track_ids: ["a", "a", "b"] }, seen).ok).toBe(false);
    expect(resolveFinish({ talk: " ", track_ids: ["a", "b", "c"] }, seen).ok).toBe(false);
  });
});

/** A DJ that only ever searches: the runaway case. Records what it was told. */
function searchingClient() {
  const prompts: string[] = [];
  let n = 0;
  const client = {
    messages: {
      create: async (req: { messages: { role: string; content: unknown }[] }) => {
        const last = req.messages.at(-1)?.content;
        if (Array.isArray(last)) {
          for (const b of last as { type: string; text?: string }[])
            if (b.type === "text" && b.text) prompts.push(b.text);
        }
        n++;
        return {
          stop_reason: "tool_use",
          usage: { input_tokens: 1, output_tokens: 1 },
          content: [
            { type: "tool_use", id: `u${n}`, name: "search_spotify", input: { query: `q${n}`, limit: 5 } },
          ],
        };
      },
    },
  };
  return { client, prompts };
}

describe("planSegment", () => {
  it("tells a DJ that keeps searching to wrap up before the cap, then fails naming what it did", async () => {
    const { client, prompts } = searchingClient();
    await expect(
      planSegment(
        { system: "s", history: [], userTurn: "go" },
        { client: client as never, model: "m", search: async () => [track("a"), track("b"), track("c")] },
      ),
    ).rejects.toThrow(/did not finish within 12 turns: 12 searches \(q1, q2, q3, …, q12\)/);
    expect(prompts.some((p) => p.includes("finish_segment now"))).toBe(true);
  });

  it("summarises a turn's tool use", () => {
    expect(
      describeTurn([
        { role: "user", content: "go" },
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "1", name: "search_spotify", input: { query: "paw patrol", limit: 5 } },
            { type: "tool_use", id: "2", name: "finish_segment", input: { talk: "t", track_ids: ["x"] } },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "1", content: "…" },
            {
              type: "tool_result",
              tool_use_id: "2",
              is_error: true,
              content: "A segment has 3 or 4 tracks; you gave 1.",
            },
          ],
        },
      ]),
    ).toBe(
      "1 search (paw patrol); finish_segment rejected 1×, last: A segment has 3 or 4 tracks; you gave 1.",
    );
  });
});
