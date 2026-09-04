/** The session document as the page reads it (the snapshot, GET /api/sessions/:id). */

/** What Qobuz says of a version; given, never judged. */
export interface Tags {
  id: string;
  title: string;
  artists: string[];
  album: string;
  image: string | null;
  durationMs: number;
}

export interface Clock {
  breakEvery: number;
  fill: number;
  lowWater: number;
}

export type SlotStatus = "proposed" | "written" | "voiced";

export type SlotKind = "break" | "talkup" | "sweeper" | "segue";

export interface Chart {
  rampMs: number;
  sure: boolean;
  post: string;
  outro: "cold" | "fade";
  outroMs: number;
  energy: number;
  tempo: "down" | "mid" | "up";
  mood: string;
}

export interface Slot {
  seq: number;
  status: SlotStatus;
  // the proposal — always present
  title: string;
  artist: string;
  why: string;
  // written and after — absent while proposed
  pick?: Tags;
  /** The bucket holds the pick's bytes: the deck plays it without a pull. */
  held?: boolean;
  /** Absent on a no-chart segue (the writer gave nothing usable). */
  chart?: Chart;
  kind?: SlotKind;
  words?: string;
  leadLine?: string;
  legalId?: string;
  treatment?: string;
  fallback?: { from: string; to: string; reason: string };
  recordUnderMs?: number;
  voiceInMs?: number;
  // voiced
  voiced: boolean;
  /** Absent on a segue. */
  clipKey?: string;
}

export interface SessionDoc {
  sessionId: string;
  prompt: string;
  voiceId: string;
  createdAt: string;
  clock: Clock;
  /** In seq order, no gaps. */
  slots: Slot[];
}

/** A slot the deck can take: written or voiced, so it has a pick and a kind. */
export type Cue = Slot & { pick: Tags; kind: SlotKind };

export const isCue = (s: Slot): s is Cue => s.pick !== undefined && s.kind !== undefined;

export const cueKey = (c: Cue) => String(c.seq);

/** The deck's phase: "held" is a pause the platform made (a call took the audio), not the listener. */
export type DeckPhase = "idle" | "loading" | "playing" | "paused" | "held" | "error";

/** The track's own clock, as of the last frame. */
export interface TrackClock {
  positionMs: number;
  durationMs: number;
  playing: boolean;
}

export const KIND_LABEL: Record<SlotKind, string> = {
  break: "Break",
  talkup: "Talk-up",
  sweeper: "Sweeper",
  segue: "Segue",
};

export const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** The browser's clock as the server wants it: ms since the listener's local midnight. */
export const clockMsNow = () => {
  const now = new Date();
  return now.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
};
