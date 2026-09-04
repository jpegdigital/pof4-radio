import type { Plan } from "./plan";

/**
 * The transport's judgment, pure. The deck runs three lanes from one clock (use-deck.ts); these
 * say, from the plan and the head, what the buttons should do at this moment.
 */

/** ⏮ this far into a slot restarts it instead of going back one (the convention). */
export const RESTART_AFTER_MS = 3000;

/**
 * Whether a paused deck can pick the slot up where it was: only once the record is on and the
 * voice is done, when the record alone is sounding and the device's own position is the truth
 * (it may have been scrubbed). Earlier — a voice over a bed, a talk-up mid-word — the mix runs
 * again from the head.
 */
export function resumes(plan: Plan, headMs: number): boolean {
  return headMs >= plan.music.atMs && (plan.mic === null || headMs >= plan.mic.endMs);
}

/** Whether the voice is on at this moment. */
export function onMic(plan: Plan, headMs: number): boolean {
  return plan.mic !== null && headMs >= plan.mic.atMs && headMs < plan.mic.endMs;
}

/** Where ⏮ goes from `index`: this slot from the top once well into it, else the one before. */
export function prevTarget(index: number, headMs: number): number {
  if (headMs > RESTART_AFTER_MS) return index;
  return Math.max(0, index - 1);
}
