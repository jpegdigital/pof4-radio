import { afterEach, expect, it, vi } from "vitest";
import { SongSources } from "./song-source";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("reuses a signature for seeks and renews after a long pause before the song can outlive it", async () => {
  let now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const fetchSource = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(
        Response.json({ url: `https://bucket.test/song?v=${now}`, expiresAt: now + 3_600_000 }),
      ),
    );
  vi.stubGlobal("fetch", fetchSource);
  const sources = new SongSources();
  const signal = new AbortController().signal;
  const first = await sources.resolve("/track?playback=1", 300_000, signal);
  now += 60_000;
  expect(await sources.resolve("/track?playback=1", 300_000, signal)).toBe(first);
  expect(fetchSource).toHaveBeenCalledOnce();
  now += 3_300_000;
  expect(await sources.resolve("/track?playback=1", 300_000, signal)).not.toBe(first);
  expect(fetchSource).toHaveBeenCalledTimes(2);
});

it("does not retain failures or cancelled resolutions", async () => {
  const fetchSource = vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 }));
  vi.stubGlobal("fetch", fetchSource);
  const sources = new SongSources();
  const signal = new AbortController().signal;
  await expect(sources.resolve("/track", 300_000, signal)).rejects.toThrow("404");
  const controller = new AbortController();
  fetchSource.mockImplementationOnce(() => {
    controller.abort();
    return Promise.resolve(
      Response.json({ url: "https://bucket.test/old", expiresAt: Date.now() + 3_600_000 }),
    );
  });
  await expect(sources.resolve("/track", 300_000, controller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  fetchSource.mockResolvedValueOnce(
    Response.json({ url: "https://bucket.test/new", expiresAt: Date.now() + 3_600_000 }),
  );
  expect(await sources.resolve("/track", 300_000, signal)).toBe("https://bucket.test/new");
  expect(fetchSource).toHaveBeenCalledTimes(3);
});
