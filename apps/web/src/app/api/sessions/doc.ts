import type { SlotFallback, SlotKind } from "./rules";

/**
 * The slot on the wire, shared by the snapshot and the rungs: status derived from presence
 * (never stored), the pick's tags read from the slot's own hits (never a join to `track`),
 * `held` from the set of track ids the caller read, and absent columns as absent keys. Never
 * on the wire: the hits (the browser has no use for them), the writer's thinking, the clock
 * the write was made at, audio.
 */

/** Qobuz's tags for one version, verbatim from search (qobuz.ts `Track` minus `streamable`). */
export interface Hit {
  id: string;
  /** Version folded in: "Dreams (2001 Remaster)". */
  title: string;
  artists: string[];
  album: string;
  /** Qobuz CDN URL. */
  image: string | null;
  durationMs: number;
}

/** What Qobuz says of the pick; given, never judged. */
export type Tags = Hit;

export type SlotStatus = "proposed" | "written" | "voiced";

/** One session_slot row as the routes read it (`SLOT_COLUMNS`). */
export interface SlotRow {
  seq: number;
  title: string;
  artist: string;
  why: string;
  hits: Hit[];
  qobuz_id: string | null;
  clock_ms: number | null;
  ramp_ms: number | null;
  sure: boolean | null;
  post: string | null;
  outro: string | null;
  outro_ms: number | null;
  energy: number | null;
  tempo: string | null;
  mood: string | null;
  kind: string | null;
  words: string | null;
  lead_line: string | null;
  legal_id: string | null;
  treatment: string | null;
  fallback: unknown;
  record_under_ms: number | null;
  voice_in_ms: number | null;
  clip_key: string | null;
  voiced_at: Date | null;
}

/** The columns `SlotRow` reads, in one place so every route selects the same. */
export const SLOT_COLUMNS =
  "seq, title, artist, why, hits, qobuz_id, clock_ms, ramp_ms, sure, post, outro, outro_ms, energy, tempo, mood, kind, words, lead_line, legal_id, treatment, fallback, record_under_ms, voice_in_ms, clip_key, voiced_at";

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

export interface SlotDoc {
  seq: number;
  status: SlotStatus;
  // the proposal — always present
  title: string;
  artist: string;
  why: string;
  // written and after — absent while proposed
  pick?: Tags;
  /** The bucket holds the pick's bytes (a `track` row exists). */
  held?: boolean;
  /** Absent on a no-chart segue (the writer gave nothing usable). */
  chart?: Chart;
  kind?: SlotKind;
  words?: string;
  leadLine?: string;
  legalId?: string;
  treatment?: string;
  fallback?: SlotFallback;
  recordUnderMs?: number;
  voiceInMs?: number;
  // voiced
  voiced: boolean;
  /** Absent on a segue. */
  clipKey?: string;
}

export function statusOf(r: { qobuz_id: string | null; voiced_at: Date | null }): SlotStatus {
  if (r.voiced_at !== null) return "voiced";
  return r.qobuz_id === null ? "proposed" : "written";
}

/** The row folded into its doc; `held` is the set of track ids the bucket holds, as of now. */
export function slotDoc(r: SlotRow, held: ReadonlySet<string>): SlotDoc {
  const d: SlotDoc = {
    seq: r.seq,
    status: statusOf(r),
    title: r.title,
    artist: r.artist,
    why: r.why,
    voiced: r.voiced_at !== null,
  };
  if (r.qobuz_id === null) return d;
  const pick = r.hits.find((h) => h.id === r.qobuz_id);
  if (!pick) throw new Error(`slot ${r.seq} picked ${r.qobuz_id}, which is not one of its hits`);
  d.pick = pick;
  d.held = held.has(pick.id);
  if (r.ramp_ms !== null && r.sure !== null && r.outro_ms !== null && r.energy !== null)
    d.chart = {
      rampMs: r.ramp_ms,
      sure: r.sure,
      post: r.post ?? "",
      outro: r.outro as Chart["outro"],
      outroMs: r.outro_ms,
      energy: r.energy,
      tempo: r.tempo as Chart["tempo"],
      mood: r.mood ?? "",
    };
  if (r.kind !== null) d.kind = r.kind as SlotKind;
  if (r.words !== null) d.words = r.words;
  if (r.lead_line !== null) d.leadLine = r.lead_line;
  if (r.legal_id !== null) d.legalId = r.legal_id;
  if (r.treatment !== null) d.treatment = r.treatment;
  if (r.fallback !== null && r.fallback !== undefined) d.fallback = r.fallback as SlotFallback;
  if (r.record_under_ms !== null) d.recordUnderMs = r.record_under_ms;
  if (r.voice_in_ms !== null) d.voiceInMs = r.voice_in_ms;
  if (r.clip_key !== null) d.clipKey = r.clip_key;
  return d;
}
