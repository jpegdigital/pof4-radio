/**
 * What the browser remembers: the voice. A per-browser convenience in localStorage — wrapped in
 * try/catch because storage can be missing or blocked. (The station is deliberately not
 * remembered: a page load is a fresh show.)
 */

export interface VoiceSettings {
  voiceId: string;
  modelId: string;
  /** v3 accepts 0 (creative), 0.5 (natural), 1 (robust); v2 models take any 0–1. */
  stability: number;
  similarityBoost: number;
  style: number;
  speed: number;
  speakerBoost: boolean;
}

export const DEFAULT_VOICE: VoiceSettings = {
  voiceId: "",
  modelId: "eleven_v3",
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0,
  speed: 1,
  speakerBoost: true,
};

export const VOICE_MODELS = [
  { id: "eleven_v3", label: "Eleven v3 (expressive)" },
  { id: "eleven_multilingual_v2", label: "Multilingual v2" },
  { id: "eleven_flash_v2_5", label: "Flash v2.5 (fast)" },
] as const;

const VOICE_KEY = "radio.voice";

export function loadVoice(): VoiceSettings {
  try {
    const raw = localStorage.getItem(VOICE_KEY);
    return raw ? { ...DEFAULT_VOICE, ...(JSON.parse(raw) as Partial<VoiceSettings>) } : DEFAULT_VOICE;
  } catch {
    return DEFAULT_VOICE;
  }
}

export function saveVoice(v: VoiceSettings): void {
  try {
    localStorage.setItem(VOICE_KEY, JSON.stringify(v));
  } catch {
    // storage unavailable — the choice just won't survive a reload
  }
}

/** The `/api/tts` URL for a line of talk in this voice. */
export function ttsUrl(text: string, v: VoiceSettings): string {
  const q = new URLSearchParams({
    text,
    voiceId: v.voiceId,
    modelId: v.modelId,
    stability: String(v.stability),
    similarityBoost: String(v.similarityBoost),
    style: String(v.style),
    speed: String(v.speed),
    speakerBoost: String(v.speakerBoost),
  });
  return `/api/tts?${q.toString()}`;
}
