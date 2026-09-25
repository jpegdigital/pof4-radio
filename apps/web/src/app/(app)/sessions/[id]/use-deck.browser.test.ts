import { afterEach, expect, it, vi } from "vitest";
import { createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { page, userEvent } from "vitest/browser";
import { tone } from "@/lib/playback/testing/audio-fixture";
import { useDeck } from "./use-deck";
import { useMediaSession } from "./media-session";
import type { Cue } from "./types";

let root: Root | null = null;
let host: HTMLDivElement;
let url: string;
const onSlot = () => {};
const cue: Cue = {
  seq: 1,
  kind: "talkup",
  held: true,
  clipKey: "take",
  voiced: true,
  status: "voiced",
  title: "Test",
  artist: "Test",
  why: "Test",
  voiceInMs: 0,
  pick: { id: "song", durationMs: 6000, title: "Test", artists: ["Test"], album: "Test", image: null },
};
function Harness() {
  const deck = useDeck({ sessionId: "browser-fixture", onSlot });
  useMediaSession({
    cue: deck.cue,
    phase: deck.phase,
    track: deck.track,
    intent: deck.intent,
    operationId: deck.operationId,
    onPlay: deck.play,
    onPause: deck.pause,
    onNext: onSlot,
    onPrev: onSlot,
  });
  return createElement(
    "div",
    null,
    createElement(
      "button",
      {
        onClick: () => {
          deck.unlock();
          deck.load(cue);
        },
      },
      "Load",
    ),
    createElement("button", { onClick: deck.pause }, "Pause"),
    createElement("button", { onClick: deck.play }, "Play"),
    createElement("button", { onClick: () => deck.seekTrack(1500) }, "Song seek"),
    createElement("button", { onClick: () => deck.seek(2500) }, "Mix seek"),
    createElement("output", { "data-testid": "phase" }, deck.phase),
    createElement("output", { "data-testid": "song" }, String(Math.round(deck.track?.positionMs ?? 0))),
    createElement("output", { "data-testid": "mix" }, String(Math.round(deck.headMs))),
  );
}
afterEach(() => {
  root?.unmount();
  root = null;
  host?.remove();
  URL.revokeObjectURL(url);
  vi.restoreAllMocks();
});

it("uses the real hook through StrictMode, paused seeks, resume, lock-screen updates and remount", async () => {
  url = tone(6);
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const fixture = await nativeFetch(url);
  const blob = await fixture.blob();
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    if (typeof input === "string" && input.endsWith("/track?playback=1"))
      return Promise.resolve(Response.json({ url, expiresAt: Date.now() + 3_600_000 }));
    if (typeof input === "string" && input.startsWith("/api/sessions/browser-fixture/"))
      return Promise.resolve(new Response(blob, { headers: { "Content-Type": "audio/wav" } }));
    return nativeFetch(input, init);
  });
  const position = navigator.mediaSession ? vi.spyOn(navigator.mediaSession, "setPositionState") : null;
  const close = vi.spyOn(AudioContext.prototype, "close");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  root.render(createElement(StrictMode, null, createElement(Harness)));
  await userEvent.click(page.getByRole("button", { name: "Load", exact: true }));
  await expect.element(page.getByTestId("phase")).toHaveTextContent("playing");
  await userEvent.click(page.getByRole("button", { name: "Pause", exact: true }));
  await expect.element(page.getByTestId("phase")).toHaveTextContent("paused");
  await userEvent.click(page.getByRole("button", { name: "Song seek" }));
  await expect.element(page.getByTestId("phase")).toHaveTextContent("paused");
  await expect.element(page.getByTestId("song")).toHaveTextContent("1500");
  await expect.element(page.getByTestId("mix")).toHaveTextContent("1500");
  await userEvent.click(page.getByRole("button", { name: "Mix seek" }));
  await expect.element(page.getByTestId("phase")).toHaveTextContent("paused");
  await expect.element(page.getByTestId("song")).toHaveTextContent("2500");
  await userEvent.click(page.getByRole("button", { name: "Play", exact: true }));
  await expect.element(page.getByTestId("phase")).toHaveTextContent("playing");
  await expect
    .poll(() => Number(page.getByTestId("song").element().textContent))
    .toBeGreaterThanOrEqual(2500);
  if (position) expect(position.mock.calls.some(([state]) => state?.position === 2.5)).toBe(true);
  root.unmount();
  expect(close).toHaveBeenCalledOnce();
  root = createRoot(host);
  root.render(createElement(StrictMode, null, createElement(Harness)));
  await expect.element(page.getByTestId("phase")).toHaveTextContent("idle");
  await userEvent.click(page.getByRole("button", { name: "Load", exact: true }));
  await expect.element(page.getByTestId("phase")).toHaveTextContent("playing");
});
