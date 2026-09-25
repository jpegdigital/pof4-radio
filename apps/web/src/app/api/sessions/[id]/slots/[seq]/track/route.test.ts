import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "./route";
import { trackPlayback } from "../../../../show-store";

vi.mock("../../../../show-store", () => ({ trackPlayback: vi.fn() }));
const id = "634d6828-5f7f-4271-b0f6-92266dd894e2";
const ctx = { params: Promise.resolve({ id, seq: "2" }) };
const endpoint = `https://radio.test/api/sessions/${id}/slots/2/track`;
const source = { url: "https://bucket.test/track?signature=test", expiresAt: 9999999999999 };
beforeEach(() => vi.resetAllMocks());

it("returns an uncached playback URL only after resolving the held slot", async () => {
  vi.mocked(trackPlayback).mockResolvedValue(source);
  const response = await GET(new Request(`${endpoint}?playback=1`), ctx);
  expect(trackPlayback).toHaveBeenCalledWith(id, 2);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual(source);
});

it("redirects direct links without caching an expiring signature", async () => {
  vi.mocked(trackPlayback).mockResolvedValue(source);
  const response = await GET(new Request(endpoint), ctx);
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe(source.url);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});

it("does not issue playback URLs for invalid or unheld slots", async () => {
  expect((await GET(new Request(endpoint), { params: Promise.resolve({ id, seq: "0" }) })).status).toBe(404);
  expect(trackPlayback).not.toHaveBeenCalled();
  vi.mocked(trackPlayback).mockResolvedValue(null);
  const response = await GET(new Request(`${endpoint}?playback=1`), ctx);
  expect(response.status).toBe(404);
  expect(response.headers.get("location")).toBeNull();
});
