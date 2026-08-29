import { describe, expect, it } from "vitest";
import { parseVoices, summarize, ttsBody, VOICE_DEFAULTS, VoiceSchema, VoicesSchema } from "./voice.ts";

const wolfe = { id: "mR1", name: "David Wolfe", gender: "male", ...VOICE_DEFAULTS, speed: 1.15 } as const;

describe("VoiceSchema", () => {
  it("accepts a tuned v3 voice", () => {
    expect(VoiceSchema.safeParse(wolfe).success).toBe(true);
  });
  it("holds v3 to the three stability modes", () => {
    const r = VoiceSchema.safeParse({ ...wolfe, stability: 0.3 });
    expect(r.success).toBe(false);
    expect(r.success || r.error.issues[0]?.path).toEqual(["stability"]);
  });
  it("lets v2 take any stability", () => {
    expect(
      VoiceSchema.safeParse({ ...wolfe, modelId: "eleven_multilingual_v2", stability: 0.3 }).success,
    ).toBe(true);
  });
  it("rejects an unknown model and an out-of-range speed", () => {
    expect(VoiceSchema.safeParse({ ...wolfe, modelId: "eleven_turbo" }).success).toBe(false);
    expect(VoiceSchema.safeParse({ ...wolfe, speed: 1.5 }).success).toBe(false);
  });
});

describe("VoicesSchema / parseVoices", () => {
  it("keeps order and refuses duplicate ids", () => {
    const two = [wolfe, { ...wolfe, id: "G3I", name: "Rachelle", gender: "female" }];
    expect(parseVoices(JSON.stringify(two)).map((v) => v.name)).toEqual(["David Wolfe", "Rachelle"]);
    expect(VoicesSchema.safeParse([wolfe, wolfe]).success).toBe(false);
  });
  it("throws on a malformed row", () => {
    expect(() => parseVoices("[{}]")).toThrow();
    expect(() => parseVoices("nope")).toThrow();
  });
});

describe("ttsBody / summarize", () => {
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
  it("summarizes to what the picker needs", () => {
    expect(summarize(wolfe)).toEqual({ id: "mR1", name: "David Wolfe", gender: "male" });
  });
});
