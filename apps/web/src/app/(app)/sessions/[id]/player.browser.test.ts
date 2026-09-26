import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Player } from "./player";
import type { Cue, DeckPhase } from "./types";

let root: Root | undefined;
let host: HTMLDivElement;
afterEach(() => {
  root?.unmount();
  host?.remove();
  root = undefined;
});
const cue: Cue = {
  seq: 1,
  status: "voiced",
  voiced: true,
  held: true,
  kind: "talkup",
  title: "Midnight City",
  artist: "M83",
  why: "A little late-night energy.",
  words: "A shimmering favourite to carry us into the night.",
  pick: {
    id: "one",
    title: "Midnight City",
    artists: ["M83"],
    album: "Hurry Up",
    image: null,
    durationMs: 240000,
  },
};
function render(phase: DeckPhase) {
  if (!root) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  }
  root.render(
    createElement(Player, {
      cue,
      phase,
      plan: {
        previewEndMs: 30000,
        mic: { atMs: 0, endMs: 15000 },
        bed: null,
        duck: null,
        music: { atMs: 10000 },
      },
      headMs: 5000,
      track: null,
      canPrev: false,
      canNext: true,
      onPrev: vi.fn(),
      onNext: vi.fn(),
      onToggle: vi.fn(),
      onScrub: () => 1,
      onSeekTrack: () => 1,
      preparation: { ready: true, busy: false, label: "Ready" },
      playbackId: "one",
      operationId: 1,
      intent: phase === "paused" ? "pause" : "play",
    }),
  );
}
it("shows the real DJ script and three-lane timeline while speaking", async () => {
  render("playing");
  await expect.element(page.getByText("Your DJ is on the mic", { exact: true })).toBeVisible();
  await expect
    .element(page.getByRole("slider", { name: "Mix timeline" }))
    .toHaveAttribute("aria-valuenow", "5");
  await page.getByText("Read the DJ script", { exact: true }).click();
  expect(host.querySelector("details")?.open).toBe(true);
  expect(host.querySelector("details")?.textContent).toContain(cue.words);
});
it("does not claim the DJ is speaking while paused or interrupted", async () => {
  render("paused");
  await expect.element(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  expect(host.querySelector(".dj-presence")?.getAttribute("data-speaking")).toBe("false");
  render("held");
  await expect.element(page.getByText("INTERRUPTED", { exact: true })).toBeVisible();
  expect(host.querySelector(".dj-presence")?.getAttribute("data-speaking")).toBe("false");
});
