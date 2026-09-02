/** The session document as the page reads it (the snapshot, GET /api/sessions/:id). */

export interface Track {
  id: string;
  uri: string;
  name: string;
  artists: string[];
  album: string;
  image: string | null;
  durationMs: number;
  pick: number;
  why: string;
}

export type SlotKind = "break" | "talkup" | "sweeper" | "segue";

export interface Slot {
  seq: number;
  trackId: string;
  kind: SlotKind;
  words?: string;
  leadLine?: string;
  legalId?: string;
  why: string;
  fallback?: { from: string; to: string; reason: string };
  recordUnderMs?: number;
  voiceInMs?: number;
  introMs?: number;
  voiced: boolean;
  clipKey?: string;
}

export type Status = "open" | "playlisted" | "programmed" | "voiced";

export interface Segment {
  num: number;
  status: Status;
  rationale: string | null;
  tracks: Track[];
  dropped: string[];
  slots: Slot[];
}

export interface SessionDoc {
  sessionId: string;
  prompt: string;
  voiceId: string;
  createdAt: string;
  segments: Segment[];
}

/** One slot as the deck takes it: the segment it is in, the slot, the record it plays. */
export interface Cue {
  num: number;
  slot: Slot;
  track: Track;
}

export const cueKey = (c: Cue) => `${c.num}:${c.slot.seq}`;

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
