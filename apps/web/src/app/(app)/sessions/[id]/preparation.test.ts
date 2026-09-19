import { describe, expect, it } from "vitest";
import { moveCompleted, preparation, preparationSteps } from "./preparation";
import type { Slot } from "./types";

const slot = (voiced: boolean, held: boolean): Slot => ({
  seq: 1,
  status: voiced ? "voiced" : "written",
  title: "Track",
  artist: "Artist",
  why: "",
  voiced,
  held,
});

describe("preparation", () => {
  it("names the current action and marks only completed work as done", () => {
    expect(preparationSteps(true, undefined, true).map(({ label }) => label)).toEqual([
      "Show created",
      "Selecting tracks…",
      "Prepare opening",
      "Download track",
    ]);
    expect(preparationSteps(true, slot(false, false), true).map(({ label }) => label)).toEqual([
      "Show created",
      "Tracks selected",
      "Preparing opening…",
      "Download track",
    ]);
    expect(preparationSteps(true, slot(true, false), true).map(({ label }) => label)).toEqual([
      "Show created",
      "Tracks selected",
      "Opening prepared",
      "Downloading track…",
    ]);
    expect(preparationSteps(true, slot(true, true), false).every((step) => step.done)).toBe(true);
  });
  it("stops the active step on failure, even when the download already finished", () => {
    const steps = preparationSteps(true, slot(false, true), false);
    expect(steps.some((step) => step.active)).toBe(false);
    expect(steps[2]).toMatchObject({ label: "Prepare opening", done: false });
    expect(steps[3]).toMatchObject({ label: "Track ready", done: true });
  });
  it("waits for the download even after the voice is ready", () => {
    expect(preparation(slot(true, false))).toEqual({
      label: "Getting your track ready…",
      busy: true,
      ready: false,
    });
  });
  it("stops activity after a voice failure, including a partially written slot", () => {
    expect(preparation(slot(false, true), { failed: true }).busy).toBe(false);
    expect(preparation(undefined, { failed: true }).busy).toBe(false);
  });
  it("offers recovery for a failed download instead of readiness", () => {
    expect(preparation(slot(true, false), { downloadFailed: true })).toEqual({
      label: "Download needs another try",
      busy: false,
      ready: false,
    });
  });
  it("keeps a playable track ready if preparation further ahead fails", () => {
    expect(preparation(slot(true, true), { failed: true }).ready).toBe(true);
  });
  it("distinguishes opening and another producer from normal preparation", () => {
    expect(preparation(undefined, { opening: true }).label).toBe("Opening your show…");
    expect(preparation(slot(false, false), { observing: true }).label).toContain("another tab");
  });
});

describe("reconciling another producer", () => {
  it("requires new slots to consider a fill complete", () => {
    expect(moveCompleted("fill:1", [slot(false, false)])).toBe(false);
    expect(moveCompleted("fill:0", [slot(false, false)])).toBe(true);
  });
  it("does not retry a completed voice, or mistake a partial write for completion", () => {
    expect(moveCompleted("slot:1", [slot(false, true)])).toBe(false);
    expect(moveCompleted("slot:1", [slot(true, false)])).toBe(true);
  });
});
