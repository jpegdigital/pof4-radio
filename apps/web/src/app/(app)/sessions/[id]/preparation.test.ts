import { describe, expect, it } from "vitest";
import { moveCompleted, preparation } from "./preparation";
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
