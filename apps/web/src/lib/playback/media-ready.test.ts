import { describe, expect, it, vi } from "vitest";
import { prepareMedia } from "./media-ready";

class Media extends EventTarget {
  src = "blob:clip";
  readyState = 0;
  currentTime = 0;
  seeking = false;
  error: { message: string } | null = null;
  load = vi.fn();
  getAttribute() {
    return this.src;
  }
  audio() {
    return this as unknown as HTMLAudioElement;
  }
}

describe("preparing the playback element", () => {
  it("waits past metadata until audio can actually play", async () => {
    const media = new Media();
    const ready = vi.fn();
    const pending = prepareMedia(media.audio(), media.src, 0, new AbortController().signal).then(ready);
    media.readyState = 1;
    media.dispatchEvent(new Event("loadedmetadata"));
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    media.readyState = 3;
    media.dispatchEvent(new Event("canplay"));
    await pending;
    expect(ready).toHaveBeenCalledOnce();
    expect(media.load).not.toHaveBeenCalled();
  });

  it("waits for a seek to finish, preserving positions beyond the mixer preview", async () => {
    const media = new Media();
    media.readyState = 3;
    media.seeking = true;
    const ready = vi.fn();
    const pending = prepareMedia(media.audio(), media.src, 90_000, new AbortController().signal).then(ready);
    expect(media.currentTime).toBe(90);
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    media.seeking = false;
    media.dispatchEvent(new Event("seeked"));
    await pending;
    expect(ready).toHaveBeenCalledOnce();
  });

  it("cancels an old preparation before another cue takes over the element", async () => {
    const media = new Media();
    const controller = new AbortController();
    const pending = prepareMedia(media.audio(), "blob:old", 10_000, controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejected;
    media.src = "blob:new";
    media.readyState = 3;
    media.dispatchEvent(new Event("canplay"));
    expect(media.currentTime).toBe(0);
  });

  it("reports decoding errors instead of leaving the deck waiting", async () => {
    const media = new Media();
    const pending = prepareMedia(media.audio(), media.src, 0, new AbortController().signal);
    const rejected = expect(pending).rejects.toThrow("decode failed");
    media.error = { message: "decode failed" };
    media.dispatchEvent(new Event("error"));
    await rejected;
  });
});
