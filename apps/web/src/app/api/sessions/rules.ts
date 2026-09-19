import type { Written } from "./shapes";
import type { Chart } from "./doc";
import type { MixPlan } from "./planning";

export type SlotKind = "break" | "talkup" | "sweeper" | "segue";
/** Retained on historical slots; new plans are never silently replaced. */
export interface SlotFallback {
  from: SlotKind;
  to: SlotKind;
  reason: string;
}
export interface WrittenSlot extends Chart {
  qobuzId: string;
  kind: SlotKind;
  words: string | null;
  leadLine: string | null;
  legalId: string | null;
  treatment: string;
  fallback: SlotFallback | null;
  recordUnderMs: number | null;
  voiceInMs: number | null;
}

const HOUR_MS = 3_600_000;

/** Slot 1 is the break, and every `breakEvery` after it: 1, 1 + k, 1 + 2k… */
export const isBreak = (seq: number, breakEvery: number) => seq === 1 || (seq - 1) % breakEvery === 0;

/**
 * The legal ID is said on slot 1 and again on the first break of every hour: when the hour of
 * this slot's clock differs from the hour of the last break's, or when no earlier break is known.
 */
export function legalIdDue(seq: number, clockMs: number, lastBreakClockMs: number | null): boolean {
  if (seq === 1 || lastBreakClockMs === null) return true;
  return Math.floor(clockMs / HOUR_MS) !== Math.floor(lastBreakClockMs / HOUR_MS);
}

/** Assemble the fixed Jev plan and Claude's copy. Invalid copy stops the slot. */
export function checkSlot(
  clockSaysBreak: boolean,
  plan: MixPlan,
  w: Written,
  hit: { id: string; durationMs: number },
  legalId: string | null,
): WrittenSlot {
  if ((plan.kind === "break") !== clockSaysBreak) throw new Error("Jev plan violates the slot clock");
  const words = w.words.trim();
  const leadLine = w.leadLine.trim();
  const count = (text: string) => (text ? text.split(/\s+/u).length : 0);
  if (count(words) > plan.wordsMax || count(leadLine) > plan.leadWordsMax)
    throw new Error("Claude copy exceeds Jev's word budget");
  if (plan.kind !== "segue" && !words) throw new Error("Claude returned empty copy for Jev's spoken plan");
  if (plan.kind === "break" && !leadLine) throw new Error("Claude returned no lead line for Jev's break");
  return {
    qobuzId: hit.id,
    ...plan.chart,
    kind: plan.kind,
    words: words || null,
    leadLine: leadLine || null,
    legalId: plan.kind === "break" ? legalId : null,
    treatment: plan.treatment,
    fallback: null,
    recordUnderMs: plan.recordUnderMs,
    voiceInMs: plan.voiceInMs,
  };
}
