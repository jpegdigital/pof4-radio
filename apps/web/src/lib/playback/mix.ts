import {
  BED_GAIN,
  bedGainAt,
  type Plan,
  trackGainPoints,
  trackLevelAt,
  voiceGainPoints,
  voiceLevelAt,
} from "./plan";

export interface PreparedSlot {
  id: string;
  plan: Plan;
  songUrl: string;
  voiceUrl: string | null;
  bedUrl: string | null;
  songDurationMs: number;
}
export type SeekTarget = { coordinate: "slot" | "song"; ms: number };
export type GainPoint = [ms: number, gain: number];
export interface LanePosition {
  phase: "before" | "active" | "ended";
  offsetMs: number;
  gain: number;
  remaining: GainPoint[];
}
export const slotDuration = (slot: PreparedSlot) =>
  Math.max(slot.plan.music.atMs + slot.songDurationMs, slot.plan.mic?.endMs ?? 0, slot.plan.bed?.outMs ?? 0);
export const clamp = (ms: number, end: number) => Math.max(0, Math.min(end, Number.isFinite(ms) ? ms : 0));
export function seekPosition(slot: PreparedSlot, target: SeekTarget): number {
  return target.coordinate === "song"
    ? slot.plan.music.atMs + clamp(target.ms, slot.songDurationMs)
    : clamp(target.ms, slotDuration(slot));
}
function lane(at: number, end: number, ms: number, gain: number, points: GainPoint[]): LanePosition {
  return {
    phase: ms < at ? "before" : ms < end ? "active" : "ended",
    offsetMs: clamp(ms - at, end - at),
    gain,
    remaining: points.filter(([time]) => time > ms),
  };
}
/** Every lane is projected from the same slot position, including the envelope after a seek. */
export function mixAt(slot: PreparedSlot, ms: number) {
  const { mic, bed, music, duck } = slot.plan;
  return {
    voice: mic
      ? lane(mic.atMs, mic.endMs, ms, voiceLevelAt(mic, ms), voiceGainPoints(mic))
      : lane(0, 0, ms, 0, []),
    bed: bed
      ? lane(bed.atMs, bed.outMs, ms, bedGainAt(bed, ms), [
          [bed.atMs, 0],
          [bed.fullMs, BED_GAIN],
          [bed.downMs, BED_GAIN],
          [bed.outMs, 0],
        ])
      : lane(0, 0, ms, 0, []),
    song: lane(
      music.atMs,
      music.atMs + slot.songDurationMs,
      ms,
      trackLevelAt(duck, ms),
      trackGainPoints(duck),
    ),
  };
}
