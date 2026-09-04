/**
 * The segment document on the wire, shared by the snapshot and the rungs: status derived from
 * presence (never stored), and a slot row folded into its doc with absent columns as absent
 * keys — words, the writer's timing numbers, the card's intro and refs only, never audio and
 * never the telemetry receipts.
 */

export type SegmentStatus = "open" | "playlisted" | "programmed" | "voiced";

export interface SlotRow {
  seq: number;
  track_id: string;
  kind: string;
  words: string | null;
  lead_line: string | null;
  legal_id: string | null;
  why: string;
  fallback: unknown;
  record_under_ms: number | null;
  voice_in_ms: number | null;
  clip_key: string | null;
  voiced_at: Date | null;
  /** The record's card, joined: the intro a talk-up plays over. */
  intro_ms: number | null;
}

export interface SlotDoc {
  seq: number;
  trackId: string;
  kind: string;
  words?: string;
  leadLine?: string;
  legalId?: string;
  why: string;
  fallback?: unknown;
  recordUnderMs?: number;
  voiceInMs?: number;
  introMs?: number;
  voiced: boolean;
  clipKey?: string;
}

/** The slot columns on the wire, plus the record's intro from the card table (alias the tables s and c). */
export const SLOT_COLUMNS =
  "seq, track_id, kind, words, lead_line, legal_id, why, fallback, record_under_ms, voice_in_ms, clip_key, voiced_at, c.intro_ms";
export const SLOT_FROM = "session_slot s left join card c on c.id = s.track_id";

/** One record of the playlist as stored (playlist.ts writes it), plus whether the bucket holds it. */
export interface TrackDoc {
  id: string;
  name: string;
  artists: string[];
  album: string;
  image: string | null;
  durationMs: number;
  pick: number;
  why: string;
  /** The record is in the bucket (a `track` row exists): the deck can play it without a pull. */
  recorded: boolean;
}

/** The segment's `tracks` jsonb on the wire, each record marked from the set of ids the track table holds. */
export function trackDocs(tracks: unknown, recorded: Set<string>): TrackDoc[] {
  if (!tracks) return [];
  return (tracks as Omit<TrackDoc, "recorded">[]).map((t) => ({ ...t, recorded: recorded.has(t.id) }));
}

export function statusOf(tracks: unknown, slots: { voiced_at: Date | null }[]): SegmentStatus {
  if (!tracks) return "open";
  if (!slots.length) return "playlisted";
  return slots.every((s) => s.voiced_at) ? "voiced" : "programmed";
}

export function slotDoc(r: SlotRow): SlotDoc {
  const d: SlotDoc = {
    seq: r.seq,
    trackId: r.track_id,
    kind: r.kind,
    why: r.why,
    voiced: r.voiced_at !== null,
  };
  if (r.words !== null) d.words = r.words;
  if (r.lead_line !== null) d.leadLine = r.lead_line;
  if (r.legal_id !== null) d.legalId = r.legal_id;
  if (r.fallback !== null && r.fallback !== undefined) d.fallback = r.fallback;
  if (r.record_under_ms !== null) d.recordUnderMs = r.record_under_ms;
  if (r.voice_in_ms !== null) d.voiceInMs = r.voice_in_ms;
  if (r.intro_ms !== null) d.introMs = r.intro_ms;
  if (r.clip_key !== null) d.clipKey = r.clip_key;
  return d;
}
