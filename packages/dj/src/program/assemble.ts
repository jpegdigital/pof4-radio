import { BEAT_MS, LEAD_FALLBACK_MS, TALKUP_LATE_MS } from "./clock-rules.ts";
import type { Card, Element, Fallback, Intro, Line, Note, Record, SegmentLog } from "./shapes.ts";
import type { ClipInfo } from "./timings.ts";

/**
 * Pure: one slot's treatment, line and measured clip become the player's elements for that
 * slot (a break or sweeper element, then the song; or the song alone), with one note per
 * element that carries a clip. Every timing is derived — clip length, the card's intro, the
 * alignment at known offsets, house constants — and every place the good version couldn't be
 * had takes the next rung of the ladder and says so in the note's `fallback`:
 *
 *   talkup   post → late (card unsure, or the clip doesn't fit) → none (no clip)
 *   break    lead → end (no lead line / alignment); break → sweeper → segue (no clip)
 *   sweeper  voiced → produced → segue
 *   bed      the bed URL, or dry when there is none
 *
 * `assemble` runs it over a whole segment's log — the same result as the slots one at a time.
 */

export interface SlotInput {
  seq: number;
  intro: Intro;
  track: Record;
  line: Line | undefined;
  card: Pick<Card, "introMs" | "sure"> | undefined;
  /** The voiced clip's measurements, or why there is none. */
  clip: ClipInfo | undefined;
  /** This slot's clip, as a play URL. */
  clipUrl: string;
  /** A produced sweeper's play URL when one is wanted, or null when there are none. Called at most once. */
  sweeper: () => string | null;
  /** The bed's play URL, or null for dry breaks. */
  bed: string | null;
  topOfHour: boolean;
  /** The element index the slot's first element will have in the segment. */
  at: number;
}

export interface AssembleInput {
  records: Record[];
  lines: Line[];
  log: SegmentLog;
  cards: Map<string, Pick<Card, "introMs" | "sure">>;
  /** By slot seq: the voiced clip's measurements, or why there is none. */
  clips: Map<number, ClipInfo>;
  /** A slot's clip → its play URL. */
  clipUrl: (seq: number) => string;
  /** Produced sweepers' play URLs, if any. */
  sweepers: string[];
  /** The bed's play URL, or null for dry breaks. */
  bed: string | null;
}

const who = (r: Record) => `${r.artists.join(", ")} — ${r.name}`;

export function assembleSlot(input: SlotInput): { elements: Element[]; notes: Note[] } {
  const { seq, track, card, line, clip, clipUrl } = input;
  const elements: Element[] = [];
  const notes: Note[] = [];
  const words = line?.words ?? "";
  const ok = clip !== undefined && "clipMs" in clip ? clip : null;
  const key = String(seq);
  /** Why there is no usable voiced clip for this slot (words missing, or the clip failed). */
  const noClip = !words
    ? "no words"
    : clip && "error" in clip
      ? `clip failed: ${clip.error}`
      : !clip
        ? "no clip"
        : null;

  const note = (n: Omit<Note, "element">, fallback?: Fallback) => {
    notes.push({ element: input.at + elements.length, ...n, ...(fallback ? { fallback } : {}) });
  };

  switch (input.intro) {
    case "segue":
      elements.push({ kind: "song", track });
      break;

    case "talkup": {
      if (noClip || !ok) {
        note(
          { seq, treatment: "talkup", words, clip: "" },
          { from: "late", to: "none", reason: noClip ?? "no clip" },
        );
        elements.push({ kind: "song", track });
        break;
      }
      const introMs = card?.introMs ?? 0;
      const landed = introMs - ok.clipMs - BEAT_MS;
      if (card?.sure && landed >= 0) {
        note({ seq, treatment: "talkup", words, clip: key, clipMs: ok.clipMs, atMs: landed });
        elements.push({ kind: "song", track, talk: { clip: clipUrl, over: "intro", atMs: landed } });
      } else {
        const reason = card?.sure
          ? `${Math.round(ok.clipMs)} ms clip over a ${introMs} ms intro`
          : "card not sure";
        note(
          { seq, treatment: "talkup", words, clip: key, clipMs: ok.clipMs, atMs: TALKUP_LATE_MS },
          { from: "post", to: "late", reason },
        );
        elements.push({
          kind: "song",
          track,
          talk: { clip: clipUrl, over: "intro", atMs: TALKUP_LATE_MS },
        });
      }
      break;
    }

    case "sweeper": {
      if (!noClip && ok) {
        note({ seq, treatment: "sweeper", words, clip: key, clipMs: ok.clipMs, leadMs: 0 });
        elements.push({ kind: "break", clip: clipUrl, leadMs: 0, label: `Sweeper → ${who(track)}` });
      } else {
        const p = input.sweeper();
        if (p) {
          // A produced sweeper is the design when nothing was written; a fallback when it was.
          note(
            { seq, treatment: "sweeper", words, clip: p, leadMs: 0 },
            words ? { from: "voice", to: "produced", reason: noClip ?? "no clip" } : undefined,
          );
          elements.push({ kind: "break", clip: p, leadMs: 0, label: `Sweeper → ${who(track)}` });
        } else {
          note(
            { seq, treatment: "sweeper", words, clip: "" },
            { from: "sweeper", to: "segue", reason: noClip ?? "no clip" },
          );
        }
      }
      elements.push({ kind: "song", track });
      break;
    }

    case "break": {
      const label = `${input.topOfHour ? "Top of the hour" : "Break"} → ${who(track)}`;
      if (noClip || !ok) {
        const p = input.sweeper();
        if (p) {
          note(
            { seq, treatment: "break", words, clip: p, leadMs: 0 },
            { from: "break", to: "sweeper", reason: noClip ?? "no clip" },
          );
          elements.push({ kind: "break", clip: p, leadMs: 0, label: `Sweeper → ${who(track)}` });
        } else {
          note(
            { seq, treatment: "break", words, clip: "" },
            { from: "break", to: "segue", reason: noClip ?? "no clip" },
          );
        }
        elements.push({ kind: "song", track });
        break;
      }
      const falls: Fallback[] = [];
      let bedInMs: number | undefined;
      if (line?.legalId) {
        if (ok.bedInMs !== undefined) bedInMs = ok.bedInMs;
        else {
          bedInMs = 0;
          falls.push({ from: "bedIn", to: "start", reason: "no alignment for the legal ID" });
        }
      } else if (input.topOfHour) {
        falls.push({ from: "bedIn", to: "start", reason: "no legal ID" });
      }
      let leadMs = LEAD_FALLBACK_MS;
      if (!line?.leadLine) falls.push({ from: "lead", to: "end", reason: "no lead line" });
      else if (ok.leadMs !== undefined && ok.leadMs > 0 && ok.leadMs < ok.clipMs) leadMs = ok.leadMs;
      else falls.push({ from: "lead", to: "end", reason: "no alignment for the lead line" });
      const fallback = falls.length
        ? {
            from: falls[0]?.from ?? "",
            to: falls[0]?.to ?? "",
            reason: falls.map((f) => f.reason).join("; "),
          }
        : undefined;
      note(
        {
          seq,
          treatment: "break",
          words: [line?.legalId, words, line?.leadLine].filter(Boolean).join(" "),
          clip: key,
          clipMs: ok.clipMs,
          bedInMs,
          leadMs,
        },
        fallback,
      );
      elements.push({
        kind: "break",
        clip: clipUrl,
        ...(input.bed ? { bed: input.bed } : {}),
        bedInMs,
        leadMs,
        label,
      });
      elements.push({ kind: "song", track });
      break;
    }
  }

  return { elements, notes };
}

/** Round-robin over the produced sweepers, starting `used` turns in; null when there are none. */
export function sweeperPicker(sweepers: string[], used = 0): () => string | null {
  let turn = used;
  return () => (sweepers.length ? (sweepers[turn++ % sweepers.length] ?? null) : null);
}

export function assemble(input: AssembleInput): { elements: Element[]; notes: Note[] } {
  const byId = new Map(input.records.map((r) => [r.id, r]));
  const lines = new Map(input.lines.map((l) => [l.seq, l]));
  const elements: Element[] = [];
  const notes: Note[] = [];
  const sweeper = sweeperPicker(input.sweepers);
  for (const slot of input.log.slots) {
    const track = byId.get(slot.id);
    if (!track) continue;
    const out = assembleSlot({
      seq: slot.seq,
      intro: slot.intro,
      track,
      line: lines.get(slot.seq),
      card: input.cards.get(slot.id),
      clip: input.clips.get(slot.seq),
      clipUrl: input.clipUrl(slot.seq),
      sweeper,
      bed: input.bed,
      topOfHour: input.log.topOfHour,
      at: elements.length,
    });
    elements.push(...out.elements);
    notes.push(...out.notes);
  }
  return { elements, notes };
}
