import type { Segment, StationLock } from "@radio/db";
import {
  type Card,
  type CardFacts,
  clockOf,
  hourTurnedBetween,
  type Record,
  SEGMENT_MIN,
  type SegmentView,
  type Skeleton,
} from "@radio/dj";
import { env } from "@/lib/env";
import { loadPromptTemplate } from "@/lib/prompts";
import { discover } from "./discover";
import { ProducerError } from "./errors";

/**
 * Open a segment: the next 3–5 records off the station's skeleton (a new hour discovered when it
 * runs short or the request changed), kept as a row with nothing produced yet. No model call
 * unless the hour has to be discovered — the slots come one at a time after (`slot.ts`), the
 * first of them before the first note. Runs under the station lock.
 */

export type Lock = Extract<StationLock, { status: "ok" }>;

export interface OpenInput {
  request: string;
  first: boolean;
  /** The listener's clock, ms since local midnight; the server's own when the browser sends none. */
  clockMs?: number;
}

export interface Opened {
  segment: SegmentView;
  skeleton: Skeleton;
  timing: { discoverMs: number; ms: number };
}

export const localClockMs = () => {
  const d = new Date();
  return ((d.getHours() * 60 + d.getMinutes()) * 60 + d.getSeconds()) * 1000;
};

export const clockFor = (clockMs: number | undefined) => clockOf(clockMs ?? localClockMs());

export const facts = (c: Card | undefined): CardFacts | null =>
  c
    ? { introMs: c.introMs, sure: c.sure, post: c.post, outro: c.outro, energy: c.energy, notes: c.notes }
    : null;

/** A kept segment as the page sees it, with the facts of the cards it was produced from. */
export function viewOf(seg: Segment, cards: Map<string, Card>): SegmentView {
  const out: SegmentView["cards"] = {};
  for (const r of seg.records) {
    const f = facts(cards.get(r.id));
    if (f) out[r.id] = f;
  }
  return {
    id: seg.id,
    seq: seg.seq,
    prompt: seg.prompt,
    complete: seg.voicedAt !== null,
    records: seg.records,
    lines: seg.lines,
    log: seg.log,
    cards: out,
    dropped: seg.dropped,
    elements: seg.elements,
    notes: seg.notes,
  };
}

/** The unconsumed run that starts at `consumed`, per the skeleton's breaks. */
function nextRun(sk: Skeleton): Record[] {
  const from = sk.consumed;
  const end = sk.breaks.find((b) => b > from) ?? sk.records.length;
  return sk.records.slice(from, end);
}

export async function openSegment(lock: Lock, input: OpenInput): Promise<Opened> {
  const t0 = Date.now();
  const { station } = lock;
  const template = await loadPromptTemplate();
  const kept = input.first ? [] : await lock.listSegments();
  const previous = kept.at(-1) ?? null;
  if (previous && previous.voicedAt === null)
    throw new ProducerError(409, `segment ${previous.seq} is still being produced`);
  const played = kept.flatMap((s) => s.records);
  const clock = clockFor(input.clockMs);
  const usage: { [k: string]: unknown } = {};
  let discoverMs = 0;

  // The skeleton: this hour's plan, or a new one when it runs short or the ask changed.
  let skeleton = station.skeleton;
  const left = skeleton ? skeleton.records.length - skeleton.consumed : 0;
  let fresh = false;
  if (!skeleton || left < SEGMENT_MIN || input.request !== station.prompt) {
    const t = Date.now();
    const d = await discover({
      template,
      request: input.request,
      dj: station.dj,
      identity: station.identity,
      clock,
      played,
    });
    discoverMs = Date.now() - t;
    usage.discover = d.usage;
    skeleton = d.skeleton;
    fresh = true;
  }

  const records = nextRun(skeleton);
  if (records.length < 1) throw new Error("the skeleton has no record left for this segment");
  skeleton = { ...skeleton, consumed: skeleton.consumed + records.length };
  await lock.setSkeleton(skeleton);

  const hourTurned = previous ? hourTurnedBetween(previous.writtenAt.getTime(), Date.now()) : false;
  const seg = await lock.createSegment({
    prompt: input.request,
    records,
    log: { slots: [], fallbacks: [], topOfHour: input.first || hourTurned },
    // The picks discovery could not find are shown on the first segment of that hour.
    dropped: fresh ? (skeleton.dropped ?? []) : [],
    usage,
    model: env().CLAUDE_MODEL,
  });
  return { segment: viewOf(seg, new Map()), skeleton, timing: { discoverMs, ms: Date.now() - t0 } };
}
