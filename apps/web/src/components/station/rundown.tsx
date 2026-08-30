import type { Element, Note, Record as RecordShape, SegmentView } from "@radio/dj";
import { ChevronDown, Mic } from "lucide-react";
import { useState } from "react";
import { clipOf, type ProgramState, type SegmentRef } from "./reducer";
import { focusRing, Label } from "./ui";
import type { ClipEntry } from "./voice-cache";

/**
 * The rundown: the whole show as produced, segment by segment, every row an element with its
 * treatment, the on-air marker, and — behind a chevron — the DJ's words, the timings that were
 * chosen, the card the row was timed from, and a badge for any fallback with its reason. A
 * segment still being produced paints the records whose slots haven't landed in the dim tone.
 * Read-only: nothing here edits or re-produces a kept row. Any kept row is a place you can jump to.
 */

export function Rundown({
  state,
  clips,
  onJump,
}: {
  state: ProgramState;
  clips: ReadonlyMap<string, ClipEntry>;
  onJump: (index: number) => void;
}) {
  const { segments, cursor } = state;
  if (!segments.length && !state.producing) return null;
  return (
    <div className="flex flex-col gap-3">
      <Label>The show</Label>
      <ol className="flex flex-col">
        {segments.map((g) => (
          <Segment
            key={g.id}
            group={g}
            state={state}
            clips={clips}
            cursor={cursor}
            producing={state.producing && g === segments.at(-1)}
            onJump={onJump}
          />
        ))}
        {!segments.length && state.producing && (
          <li className="pl-4">
            <Header seq={1} ask={null} status="finding the records…" topOfHour={false} here={false} />
          </li>
        )}
      </ol>
    </div>
  );
}

function Segment({
  group,
  state,
  clips,
  cursor,
  producing,
  onJump,
}: {
  group: SegmentRef;
  state: ProgramState;
  clips: ReadonlyMap<string, ClipEntry>;
  cursor: number | null;
  producing: boolean;
  onJump: (index: number) => void;
}) {
  const { view } = group;
  const here = cursor !== null && cursor >= group.from && cursor < group.to;
  const noteOf = new Map(view.notes.map((n) => [n.element, n]));
  const byId = new Map(view.records.map((r) => [r.id, r]));
  // the request is printed where it changes — a new ask mid-show — not on every block
  const prev = state.segments[state.segments.indexOf(group) - 1];
  const newAsk = !prev || prev.view.prompt !== view.prompt;
  const toCome = view.complete ? [] : view.records.slice(view.log.slots.length);
  return (
    <li className={`flex flex-col ${group.seq > 1 ? "mt-3 border-t border-zinc-800/80" : ""}`}>
      <Header
        seq={view.seq}
        ask={newAsk ? view.prompt : null}
        status={toCome.length ? (producing ? "producing…" : "waiting") : ""}
        topOfHour={view.log.topOfHour}
        here={here}
      />
      {view.dropped.length > 0 && (
        <p className="pl-4 text-xs text-amber-300/80">
          Not found: {view.dropped.map((d) => d.reason).join(" · ")}
        </p>
      )}
      <div className="mt-1 flex flex-col">
        {state.elements.slice(group.from, group.to).map((el, i) => {
          const index = group.from + i;
          const note = noteOf.get(i) ?? null;
          return (
            <Row
              key={`${index}-${clipOf(el) ?? el.kind}`}
              el={el}
              note={note}
              card={cardFor(view, el, byId)}
              tone={cursor === null ? "ahead" : index === cursor ? "on" : index < cursor ? "played" : "ahead"}
              clip={clipEntry(el, clips)}
              onTap={() => onJump(index)}
            />
          );
        })}
        {toCome.map((rec, i) => (
          <ToCome key={rec.id} rec={rec} label={i === 0 && producing ? "producing…" : ""} />
        ))}
      </div>
    </li>
  );
}

/** The card facts for the record an element plays (a break's are the song after it). */
function cardFor(view: SegmentView, el: Element, byId: Map<string, RecordShape>) {
  if (el.kind !== "song") return null;
  const rec = [...byId.values()].find((r) => r.uri === el.track.uri);
  return rec ? (view.cards[rec.id] ?? null) : null;
}

/** A record whose slot hasn't landed: what will play, in the dim tone. */
function ToCome({ rec, label }: { rec: RecordShape; label: string }) {
  return (
    <div className="rail-row flex items-center gap-2.5 py-2 pr-2 pl-4 text-zinc-500">
      <Chip>{label || "next"}</Chip>
      <span className="min-w-0 flex-1 truncate text-sm">
        <span className="text-zinc-300">{rec.name}</span> · {rec.artists.join(", ")}
      </span>
      <span className="font-mono text-xs tabular-nums opacity-50">{clock(rec.durationMs)}</span>
    </div>
  );
}

function Header({
  seq,
  ask,
  status,
  topOfHour,
  here,
}: {
  seq: number;
  /** The listener's request, shown where it changes; never the DJ's words. */
  ask: string | null;
  status: string;
  topOfHour: boolean;
  here: boolean;
}) {
  return (
    <div className={`rail-row pt-4 pb-1.5 pl-4 ${here ? "lit" : ""}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-2">
          <span
            className={`shrink-0 font-display text-[11px] font-semibold uppercase tracking-[0.22em] ${
              here ? "text-lamp" : "text-zinc-500"
            }`}
          >
            Segment {seq}
          </span>
          {topOfHour && <Chip tone="amber">top of the hour</Chip>}
        </span>
        {status && <span className="min-w-0 truncate text-xs text-zinc-600">{status}</span>}
      </div>
      {ask && (
        <p className="mt-1 flex items-baseline gap-2 pr-3 text-xs text-zinc-500">
          <Chip>ask</Chip>
          <span className="min-w-0 truncate">{ask}</span>
        </p>
      )}
    </div>
  );
}

/** Where a row stands tonight: already played, on air now, or still ahead. */
type Tone = "played" | "on" | "ahead";
const TONE: Record<Tone, string> = { played: "text-zinc-500", on: "text-lamp", ahead: "text-zinc-400" };

function Row({
  el,
  note,
  card,
  tone,
  clip,
  onTap,
}: {
  el: Element;
  note: Note | null;
  card: SegmentView["cards"][string] | null;
  tone: Tone;
  clip: ClipEntry | null;
  onTap: () => void;
}) {
  const [open, setOpen] = useState(false);
  const detail = note !== null || card !== null;
  return (
    <div className={`rail-row ${tone === "ahead" ? "" : "lit"}`}>
      <div className={`flex w-full items-start gap-2 pr-1 pl-4 ${TONE[tone]}`}>
        <button
          type="button"
          onClick={onTap}
          aria-current={tone === "on" ? "true" : undefined}
          className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-2 text-left transition hover:bg-zinc-800/50 ${focusRing}`}
        >
          {el.kind === "break" ? (
            <Mic className="size-3.5 shrink-0 opacity-70" strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <Chip>{note?.treatment ?? "segue"}</Chip>
          )}
          <span className="min-w-0 flex-1 truncate text-sm">
            {el.kind === "song" ? (
              <>
                <span className={tone === "on" ? "" : "text-zinc-200"}>{el.track.name}</span>
                <span className={tone === "ahead" ? "text-zinc-500" : "opacity-70"}>
                  {" "}
                  · {el.track.artists.join(", ")}
                </span>
              </>
            ) : (
              <span className={tone === "on" ? "" : "text-zinc-200"}>{el.label}</span>
            )}
          </span>
          {note?.fallback && <Badge fallback={note.fallback} />}
          <span className="font-mono text-xs tabular-nums opacity-50">
            {el.kind === "song"
              ? clock(el.track.durationMs)
              : clip && "url" in clip
                ? clock(clip.durationMs)
                : "—"}
          </span>
        </button>
        {detail && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Hide detail" : "Show detail"}
            aria-expanded={open}
            className={`mt-1.5 rounded-full p-1 text-zinc-500 transition hover:text-zinc-200 ${focusRing}`}
          >
            <ChevronDown className={`size-4 transition ${open ? "rotate-180" : ""}`} strokeWidth={1.75} />
          </button>
        )}
      </div>
      {open && <Detail el={el} note={note} card={card} />}
    </div>
  );
}

/** Words, timings, the card's facts, the fallback and its reason. Nothing editable. */
function Detail({
  el,
  note,
  card,
}: {
  el: Element;
  note: Note | null;
  card: SegmentView["cards"][string] | null;
}) {
  const timings: [string, number | undefined][] = note
    ? [
        ["clip", note.clipMs],
        ["bed in", note.bedInMs],
        ["lead", note.leadMs],
        ["talk at", note.atMs],
      ]
    : [];
  return (
    <div className="mb-2 ml-4 flex flex-col gap-2 rounded-lg border border-zinc-800/70 bg-zinc-950/60 px-3 py-2.5 text-xs text-zinc-400">
      {note?.words && (
        <p className="whitespace-pre-line font-mono text-[12px] leading-relaxed text-zinc-300">
          {note.words}
        </p>
      )}
      {note && (
        <p className="flex flex-wrap gap-x-4 gap-y-1 font-mono tabular-nums">
          {timings.map(
            ([k, v]) =>
              v !== undefined && (
                <span key={k}>
                  {k} {secs(v)}
                </span>
              ),
          )}
          {el.kind === "break" && el.leadMs === 0 && <span>hard intro</span>}
        </p>
      )}
      {card && (
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          <span>
            intro {secs(card.introMs)}
            {card.sure ? "" : " (unsure)"}
          </span>
          <span>{card.post ? `vocal: ${card.post}` : "no vocal"}</span>
          <span>ends {card.outro}</span>
          <span>energy {card.energy}/5</span>
        </p>
      )}
      {note?.fallback && (
        <p className="text-amber-300/90">
          {note.fallback.from} → {note.fallback.to}: {note.fallback.reason}
        </p>
      )}
    </div>
  );
}

function Badge({ fallback }: { fallback: NonNullable<Note["fallback"]> }) {
  return (
    <span
      title={fallback.reason}
      className="shrink-0 rounded-full border border-amber-700/60 bg-amber-900/30 px-1.5 py-px font-mono text-[10px] text-amber-300"
    >
      {fallback.from} → {fallback.to}
    </span>
  );
}

function Chip({ children, tone = "zinc" }: { children: React.ReactNode; tone?: "zinc" | "amber" }) {
  return (
    <span
      className={`shrink-0 rounded-[3px] px-1.5 py-px font-mono text-[10px] uppercase tracking-widest ${
        tone === "amber" ? "bg-lamp/15 text-lamp" : "bg-zinc-800 text-zinc-400"
      }`}
    >
      {children}
    </span>
  );
}

function clipEntry(el: Element, clips: ReadonlyMap<string, ClipEntry>): ClipEntry | null {
  const name = clipOf(el);
  return name ? (clips.get(name) ?? null) : null;
}

function clock(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
