import { describe, expect, it, vi } from "vitest";
import { ElevenLabsError, speak, speakStream, ttsBody } from "./elevenlabs";
import { VOICE_DEFAULTS } from "./voices";

const wolfe = { id: "mR1/x", name: "David Wolfe", gender: "male", ...VOICE_DEFAULTS, speed: 1.15 } as const;
const audio = () => vi.fn<typeof fetch>(() => Promise.resolve(new Response(new Uint8Array([1, 2, 3]))));

describe("ttsBody", () => {
  it("assembles the ElevenLabs body from the voice", () => {
    expect(ttsBody(wolfe, "Hello, night owls.")).toEqual({
      text: "Hello, night owls.",
      model_id: "eleven_v3",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0,
        speed: 1.15,
        use_speaker_boost: true,
      },
    });
  });
});

describe("speak — one POST, timed, the whole take", () => {
  it("posts the body in the voice with the key and returns the bytes and the request sent", async () => {
    const fetchFn = audio();
    const take = await speak(wolfe, "Hello, night owls.", { apiKey: "key", fetchFn });
    expect([...take.bytes]).toEqual([1, 2, 3]);
    expect(take.request).toEqual(ttsBody(wolfe, "Hello, night owls."));
    expect(take.elapsedMs).toBeGreaterThanOrEqual(0);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://api.elevenlabs.io/v1/text-to-speech/mR1%2Fx?output_format=mp3_44100_128");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ "xi-api-key": "key", Accept: "audio/mpeg" });
    expect(JSON.parse(init?.body as string)).toEqual(take.request);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("a refused call carries the status and the body, cut short", async () => {
    const fetchFn = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(`quota exceeded ${"x".repeat(500)}`, { status: 429 })),
    );
    const err = await speak(wolfe, "Hello.", { apiKey: "key", fetchFn }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ElevenLabsError);
    expect((err as ElevenLabsError).status).toBe(429);
    expect((err as ElevenLabsError).message).toMatch(/429.*quota exceeded/);
    expect((err as ElevenLabsError).message.length).toBeLessThan(300);
  });

  it("a call that never lands is an ElevenLabsError with no status and the cause kept", async () => {
    const cause = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    const fetchFn = vi.fn<typeof fetch>(() => Promise.reject(cause));
    const err = await speak(wolfe, "Hello.", { apiKey: "key", fetchFn }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ElevenLabsError);
    expect((err as ElevenLabsError).status).toBeNull();
    expect((err as ElevenLabsError).message).toMatch(/ElevenLabs.*timeout/);
    expect((err as ElevenLabsError).cause).toBe(cause);
  });

  it("the caller's timeout overrides the default", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    await speak(wolfe, "Hello.", { apiKey: "key", fetchFn: audio() });
    await speak(wolfe, "Hello.", { apiKey: "key", timeoutMs: 5_000, fetchFn: audio() });
    expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([30_000, 5_000]);
    timeout.mockRestore();
  });
});

describe("speakStream — the same POST, handed through unread", () => {
  it("asks the stream endpoint and returns the body as it arrives", async () => {
    const fetchFn = audio();
    const body = await speakStream(wolfe, "Hello.", { apiKey: "key", fetchFn });
    expect([...new Uint8Array(await new Response(body).arrayBuffer())]).toEqual([1, 2, 3]);
    expect(fetchFn.mock.calls[0][0]).toBe(
      "https://api.elevenlabs.io/v1/text-to-speech/mR1%2Fx/stream?output_format=mp3_44100_128",
    );
    expect(fetchFn.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("a refused call is the same typed error", async () => {
    const fetchFn = vi.fn<typeof fetch>(() => Promise.resolve(new Response("bad voice", { status: 404 })));
    const err = await speakStream(wolfe, "Hello.", { apiKey: "key", fetchFn }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ElevenLabsError);
    expect((err as ElevenLabsError).status).toBe(404);
  });

  it("an answer with no body is refused", async () => {
    const fetchFn = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 200 })));
    await expect(speakStream(wolfe, "Hello.", { apiKey: "key", fetchFn })).rejects.toThrow(ElevenLabsError);
  });
});
