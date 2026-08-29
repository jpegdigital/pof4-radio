import { z } from "zod";

/**
 * The DJs' voices: a roster kept as one JSON row in `settings` (`VOICES_KEY`), edited on
 * /settings and read per request by `/api/tts` and `/api/voices`. Each voice is an ElevenLabs
 * voice id plus the tuned settings for one model. This module is the one shape both sides
 * share: what a voice is, which models exist and which knobs each takes, and how a voice plus a
 * line of talk becomes the ElevenLabs request body. Nothing here reads the environment.
 */

export const VOICES_KEY = "voices";

/** The models the form offers, with what each does with the knobs. */
export const VOICE_MODELS = [
  {
    id: "eleven_v3",
    label: "Eleven v3",
    blurb:
      "Most expressive; reads [audio tags] in the talk. Stability is a mode: Creative, Natural or Robust. Speed and style are ignored.",
    /** v3 accepts only these three stabilities. */
    stabilities: [
      { value: 0, label: "Creative" },
      { value: 0.5, label: "Natural" },
      { value: 1, label: "Robust" },
    ],
  },
  {
    id: "eleven_multilingual_v2",
    label: "Multilingual v2",
    blurb: "Steadier and cheaper; ignores audio tags. Stability and style are continuous; speed works.",
    stabilities: null,
  },
] as const;

export type VoiceModelId = (typeof VOICE_MODELS)[number]["id"];

const MODEL_IDS = VOICE_MODELS.map((m) => m.id) as [VoiceModelId, ...VoiceModelId[]];

export const VoiceSchema = z
  .object({
    /** The ElevenLabs voice id; doubles as the DJ's id. */
    id: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(40),
    gender: z.enum(["female", "male"]),
    modelId: z.enum(MODEL_IDS),
    stability: z.number().min(0).max(1),
    similarityBoost: z.number().min(0).max(1),
    style: z.number().min(0).max(1),
    speed: z.number().min(0.7).max(1.2),
    speakerBoost: z.boolean(),
  })
  .refine((v) => v.modelId !== "eleven_v3" || [0, 0.5, 1].includes(v.stability), {
    message: "Eleven v3 takes stability 0, 0.5 or 1 only.",
    path: ["stability"],
  });

export type Voice = z.infer<typeof VoiceSchema>;

/** The roster: array order is picker order and the first is the default. Ids are unique. */
export const VoicesSchema = z
  .array(VoiceSchema)
  .refine((vs) => new Set(vs.map((v) => v.id)).size === vs.length, { message: "Two voices share an id." });

/** ElevenLabs' own defaults on v3, Natural — what a new voice starts from. */
export const VOICE_DEFAULTS: Omit<Voice, "id" | "name" | "gender"> = {
  modelId: "eleven_v3",
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0,
  speed: 1,
  speakerBoost: true,
};

/** Parse the `settings.voices` row. Throws on a malformed row — a fault, not a fallback. */
export function parseVoices(json: string): Voice[] {
  return VoicesSchema.parse(JSON.parse(json));
}

/** What the station page learns about a voice — enough to pick one, none of the tuning. */
export interface VoiceSummary {
  id: string;
  name: string;
  gender: Voice["gender"];
}

export const summarize = (v: Voice): VoiceSummary => ({ id: v.id, name: v.name, gender: v.gender });

/** The ElevenLabs text-to-speech request body for one line of talk in this voice. */
export function ttsBody(voice: Voice, text: string) {
  return {
    text,
    model_id: voice.modelId,
    voice_settings: {
      stability: voice.stability,
      similarity_boost: voice.similarityBoost,
      style: voice.style,
      speed: voice.speed,
      use_speaker_boost: voice.speakerBoost,
    },
  };
}
