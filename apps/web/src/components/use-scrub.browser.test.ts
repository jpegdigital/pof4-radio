import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useScrub } from "./use-scrub";
import type { ScrubSnapshot } from "./scrub";

let root: Root | undefined;
let host: HTMLDivElement;
afterEach(() => {
  root?.unmount();
  host?.remove();
  root = undefined;
});
function Slider({ snapshot, commit }: { snapshot: ScrubSnapshot; commit: (ms: number) => number | null }) {
  const { shown, handlers } = useScrub(snapshot, commit);
  return createElement(
    "div",
    {
      ...handlers,
      role: "slider",
      tabIndex: 0,
      "aria-label": "Scrub",
      "aria-valuenow": shown,
      style: { width: 200, height: 30, touchAction: "none" },
    },
    String(shown),
  );
}
const initial: ScrubSnapshot = {
  cueId: "one",
  positionMs: 1000,
  durationMs: 10_000,
  operationId: 1,
  seeking: false,
};
function render(snapshot: ScrubSnapshot, commit: (ms: number) => number | null) {
  if (!root) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  }
  root.render(createElement(Slider, { snapshot, commit }));
}

describe("real React scrub interaction", () => {
  it("does not jump back after release while native seek confirmation is delayed", async () => {
    const commit = vi.fn((_ms: number) => 2);
    render(initial, commit);
    const slider = page.getByRole("slider");
    await userEvent.click(slider, { position: { x: 150, y: 15 } });
    expect(commit).toHaveBeenCalledOnce();
    const target = commit.mock.calls[0][0];
    // Native pointer coordinates may round by one CSS pixel across browser/device scales.
    expect(Math.abs(target - 7500)).toBeLessThan(50);
    await expect.element(slider).toHaveAttribute("aria-valuenow", String(target));
    render({ ...initial, positionMs: 1200 }, commit);
    await expect.element(slider).toHaveAttribute("aria-valuenow", String(target));
    render({ ...initial, operationId: 2, seeking: true, positionMs: 1300 }, commit);
    await expect.element(slider).toHaveAttribute("aria-valuenow", String(target));
    render({ ...initial, operationId: 2, positionMs: 7520 }, commit);
    await expect.element(slider).toHaveAttribute("aria-valuenow", "7520");
  });
  it("repeated keyboard seeks advance from the pending target without waiting for a render from audio", async () => {
    let operation = 1;
    const commit = vi.fn((_ms: number) => ++operation);
    render(initial, commit);
    const slider = page.getByRole("slider");
    await userEvent.click(slider, { position: { x: 100, y: 15 } });
    await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowLeft}");
    const first = commit.mock.calls[0][0];
    expect(Math.abs(first - 5000)).toBeLessThan(50);
    expect(commit.mock.calls.map(([ms]) => ms - first)).toEqual([0, 1000, 2000, 1000]);
    await expect.element(slider).toHaveAttribute("aria-valuenow", String(first + 1000));
  });
  it("a cue replacement clears the pending preview", async () => {
    const commit = vi.fn(() => 2);
    render(initial, commit);
    const slider = page.getByRole("slider");
    await userEvent.click(slider, { position: { x: 150, y: 15 } });
    render({ ...initial, cueId: "two", positionMs: 0, operationId: 3 }, commit);
    await expect.element(slider).toHaveAttribute("aria-valuenow", "0");
  });
});
