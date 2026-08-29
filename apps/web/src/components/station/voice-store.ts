/**
 * The DJs: a fixed roster, each an ElevenLabs voice with its tuned settings. The browser remembers
 * which one is picked — a per-browser convenience in localStorage, wrapped in try/catch because
 * storage can be missing or blocked. (The station is deliberately not remembered: a page load is a
 * fresh show.)
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

export interface Dj {
  /** The ElevenLabs voice id doubles as the DJ's id. */
  id: string;
  name: string;
  gender: "female" | "male";
  voice: VoiceSettings;
}

/** ElevenLabs defaults on v3, Natural. */
const BASE = {
  modelId: "eleven_v3",
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0,
  speed: 1,
  speakerBoost: true,
};

const dj = (id: string, name: string, gender: Dj["gender"], tune: Partial<VoiceSettings> = {}): Dj => ({
  id,
  name,
  gender,
  voice: { ...BASE, ...tune, voiceId: id },
});

/** The first is the default and sits alone at the top of the picker; the rest are grouped by gender. */
export const DJS: readonly Dj[] = [
  dj("mR1dRpBxfiThJHgub8nr", "David Wolfe", "male", { speed: 1.15 }),
  dj("G3Il95iGz0lclzMySk7L", "Rachelle", "female"),
  dj("FmJ4FDkdrYIKzBTruTkV", "David Hertal", "male", { stability: 1, speed: 1.1 }),
  dj("QTGiyJvep6bcx4WD1qAq", "Guy", "male", { speed: 1.1 }),
  dj("HRttR5MBBbw7AvtIFoRq", "Johi", "male"),
  dj("6psAnGNeDguzLyTxKYvI", "Tim", "male"),
];

export const DEFAULT_DJ = DJS[0];

export function findDj(id: string): Dj {
  return DJS.find((d) => d.id === id) ?? DEFAULT_DJ;
}

const DJ_KEY = "radio.dj";

export function loadDj(): Dj {
  try {
    return findDj(localStorage.getItem(DJ_KEY) ?? "");
  } catch {
    return DEFAULT_DJ;
  }
}

export function saveDj(d: Dj): void {
  try {
    localStorage.setItem(DJ_KEY, d.id);
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
