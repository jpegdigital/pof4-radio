import type { Card } from "@radio/db";
import {
  assembleSlot,
  type ClipInfo,
  type Note,
  type SegmentView,
  sweeperPicker,
  type Voice,
  headlinesText,
  weatherText,
} from "@radio/dj";
import { bucket, clipKey } from "@/lib/bucket";
import { db } from "@/lib/db";
import { loadPromptTemplate } from "@/lib/prompts";
import { cardFor } from "./cards";
import { ProducerError } from "./errors";
import { fetchHeadlines } from "./headlines";
import { clockFor, type Lock, viewOf } from "./segment";
import { BED_URL, clipUrl, speak, sweeperUrls } from "./voice";
import { fetchWeather, WEATHER_PLACE } from "./weather";
import { writeSlot } from "./write";

/**
 * One slot, end to end: the record's card (table first, made if missing), its line (one call),
 * the clock rules, the clip through ElevenLabs into the bucket, the elements assembled and the
 * segment row grown — under the station lock. Slots go in order; a slot already produced is
 * returned as kept. A failed clip is a fallback, never an error. The last slot completes the
 * segment, immutable after.
 */

export interface SlotInput {
  clockMs?: number;
}

export interface SlotTiming {
  cardMs: number;
  writeMs: number;
  voiceMs: number;
  ms: number;
}

export interface Produced {
  segment: SegmentView;
  seq: number;
  timing: SlotTiming;
}

/** The talk of every slot kept on the station so far, in order, for the brief. */
const saidOn = (segments: { lines: { words: string; legalId?: string; leadLine?: string }[] }[]) =>
  segments.flatMap((s) => s.lines.map((l) => [l.legalId, l.words, l.leadLine].filter(Boolean).join(" ")));

export async function produceSlot(
  lock: Lock,
  segmentId: string,
  seq: number,
  voice: Voice,
  input: SlotInput,
): Promise<Produced> {
  const t0 = Date.now();
  const { station } = lock;
  const segment = await lock.getSegment(segmentId);
  if (!segment) throw new ProducerError(404, "unknown segment");
  const cardsOf = async (s: typeof segment) => db().getCards(s.records.map((r) => r.id));
  const done = segment.log.slots.length;
  if (seq < done || segment.voicedAt) {
    return {
      segment: viewOf(segment, await cardsOf(segment)),
      seq,
      timing: { cardMs: 0, writeMs: 0, voiceMs: 0, ms: 0 },
    };
  }
  if (seq !== done) throw new ProducerError(409, `slot ${done} comes before slot ${seq}`);
  const rec = segment.records[seq];
  if (!rec) throw new ProducerError(400, `no record at slot ${seq}`);
  const store = bucket();
  if (!store) throw new ProducerError(503, "the clips bucket is not configured (BUCKET_*)");

  const template = await loadPromptTemplate();
  const timing: SlotTiming = { cardMs: 0, writeMs: 0, voiceMs: 0, ms: 0 };

  // The card.
  let t = Date.now();
  const carded = await cardFor(template, rec);
  timing.cardMs = Date.now() - t;
  const fallbacks = [...segment.log.fallbacks];
  if (!carded.card && carded.reason)
    fallbacks.push({ seq, from: "talkup", to: "segue", reason: carded.reason });

  // The words. The weather and the headlines ride along; a failed pull is logged and the slot goes on without it.
  const orNull = (what: string) => (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[segment ${segment.id.slice(0, 8)}] ${what} pull failed, writing without it: ${message}`);
    return null;
  };
  const [kept, weather, headlines] = await Promise.all([
    lock.listSegments(),
    fetchWeather()
      .then((wx) => weatherText(wx, WEATHER_PLACE.timeZone))
      .catch(orNull("weather")),
    fetchHeadlines()
      .then((h) => headlinesText(h, WEATHER_PLACE.city))
      .catch(orNull("headlines")),
  ]);
  t = Date.now();
  const w = await writeSlot({
    weather,
    headlines,
    template,
    request: segment.prompt,
    dj: station.dj,
    identity: station.identity,
    clock: clockFor(input.clockMs),
    seq,
    records: segment.records,
    card: carded.card ?? undefined,
    said: saidOn(kept),
    topOfHour: segment.log.topOfHour,
  });
  timing.writeMs = Date.now() - t;
  fallbacks.push(...w.fallbacks);

  // The clip.
  let clip: ClipInfo | undefined;
  t = Date.now();
  if (w.line?.words) {
    try {
      const spoken = await speak(voice, w.line);
      await store.put(clipKey(station.id, segment.id, seq), spoken.bytes, "audio/mpeg");
      clip = spoken.info;
    } catch (err) {
      clip = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  timing.voiceMs = Date.now() - t;

  // The elements.
  const usedSweepers = segment.notes.filter((n: Note) => n.clip.startsWith("/sweepers/")).length;
  const out = assembleSlot({
    seq,
    intro: w.intro,
    track: rec,
    line: w.line ?? undefined,
    card: carded.card ?? undefined,
    clip,
    clipUrl: clipUrl(segment.id, seq),
    sweeper: sweeperPicker(await sweeperUrls(), usedSweepers),
    bed: BED_URL,
    topOfHour: segment.log.topOfHour,
    at: segment.elements.length,
  });

  timing.ms = Date.now() - t0;
  const slots = Array.isArray(segment.usage.slots) ? (segment.usage.slots as unknown[]) : [];
  const saved = await lock.saveSegment(segment.id, {
    lines: w.line ? [...segment.lines, w.line] : segment.lines,
    log: {
      slots: [...segment.log.slots, { seq, id: rec.id, intro: w.intro, why: w.why }],
      fallbacks,
      topOfHour: segment.log.topOfHour,
    },
    elements: [...segment.elements, ...out.elements],
    notes: [...segment.notes, ...out.notes],
    usage: {
      ...segment.usage,
      slots: [
        ...slots,
        {
          seq,
          card: carded.made ? carded.usage : carded.card ? "reused" : "none",
          write: w.usage,
          voice: clip ? ("error" in clip ? `failed: ${clip.error}` : "ok") : "none",
          timing,
        },
      ],
    },
    complete: seq + 1 >= segment.records.length,
  });
  if (!saved) throw new ProducerError(409, "the segment was completed by another caller");
  const cards = await cardsOf(saved);
  if (carded.card) cards.set(carded.card.id, carded.card as Card);
  return { segment: viewOf(saved, cards), seq, timing };
}
