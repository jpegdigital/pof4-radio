import { ChevronDown, Mic, RefreshCw } from "lucide-react";
import { useState } from "react";
import { focusRing, Label } from "@/components/station/ui";
import { type Cue, clock, cueKey, KIND_LABEL, type Segment, secs, type Slot, type Track } from "./types";

/**
 * The show as produced, lifted from the old station's rundown: a segment at a time, every row a
 * slot with its kind, the record it plays, the on-air marker on the amber rail, and behind a
 * chevron the words, the writer's numbers, the card's intro and any fallback. A segment whose
 * program hasn't landed paints its records in the dim tone. Tap a row and it goes in the deck;
 * the arrows beside a voiced row ask for another take of its clip, read with the roster as it
 * stands now (the words never change).
 */

export function Rundown({
  segments,
  producing,
  cursor,
  retaking,
  onPick,
  onRetake,
}: {
  segments: Segment[];
  /** What the page is producing right now, by segment number, in words. */
  producing: { num: number; label: string } | null;
  /** The cue in the deck, if any. */
  cursor: string | null;
  /** The cue whose clip is being voiced again, if any. */
  retaking: string | null;
  onPick: (cue: Cue) => void;
  onRetake: (cue: Cue) => void;
}) {
  const cues = segments.flatMap((g) =>
    g.slots.flatMap((slot) => {
      const track = g.tracks.find((t) => t.id === slot.trackId);
      return track ? [{ num: g.num, slot, track }] : [];
    }),
  );
  const at = cursor === null ? -1 : cues.findIndex((c) => cueKey(c) === cursor);
  return (
    <div className="flex flex-col gap-3">
      <Label>The show</Label>
      <ol className="flex flex-col">
        {segments.map((g) => {
          const busy = producing?.num === g.num ? producing.label : "";
          const here = cursor !== null && cursor.startsWith(`${g.num}:`);
          return (
            <li
              key={g.num}
              className={`flex flex-col ${g.num > 1 ? "mt-3 border-t border-zinc-800/80" : ""}`}
            >
              <div className={`rail-row pt-4 pb-1.5 pl-4 ${here ? "lit" : ""}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <span
                    className={`shrink-0 font-display text-[11px] font-semibold uppercase tracking-[0.22em] ${
                      here ? "text-lamp" : "text-zinc-500"
                    }`}
                  >
                    Segment {g.num}
                  </span>
                  {busy && <span className="min-w-0 truncate text-xs text-zinc-600">{busy}</span>}
                </div>
                {g.rationale && (
                  <p className="mt-1 pr-3 text-xs leading-relaxed text-zinc-500">{g.rationale}</p>
                )}
                {g.dropped.length > 0 && (
                  <p className="mt-1 pr-3 text-xs text-amber-300/80">Not found: {g.dropped.join(" · ")}</p>
                )}
              </div>
              <div className="mt-1 flex flex-col">
                {g.slots.length > 0
                  ? g.slots.map((slot) => {
                      const track = g.tracks.find((t) => t.id === slot.trackId);
                      if (!track) return null;
                      const cue = { num: g.num, slot, track };
                      const i = cues.findIndex((c) => c.num === g.num && c.slot.seq === slot.seq);
                      const tone: Tone = at < 0 ? "ahead" : i === at ? "on" : i < at ? "played" : "ahead";
                      const key = cueKey(cue);
                      return (
                        <Row
                          key={slot.seq}
                          slot={slot}
                          track={track}
                          tone={tone}
                          retaking={retaking === key}
                          onTap={() => onPick(cue)}
                          onRetake={slot.voiced && slot.words ? () => onRetake(cue) : null}
                        />
                      );
                    })
                  : g.tracks.map((t, i) => (
                      <ToCome key={t.id} track={t} label={i === 0 && busy ? busy : "next"} />
                    ))}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Where a row stands tonight: already played, on air now, or still ahead. */
type Tone = "played" | "on" | "ahead";
const TONE: Record<Tone, string> = { played: "text-zinc-500", on: "text-lamp", ahead: "text-zinc-400" };

function Row({
  slot,
  track,
  tone,
  retaking,
  onTap,
  onRetake,
}: {
  slot: Slot;
  track: Track;
  tone: Tone;
  retaking: boolean;
  onTap: () => void;
  /** Another take of the clip, or null when there is nothing said to read again. */
  onRetake: (() => void) | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`rail-row ${tone === "ahead" ? "" : "lit"}`}>
      <div className={`flex w-full items-start gap-2 pr-1 pl-4 ${TONE[tone]}`}>
        <button
          type="button"
          onClick={onTap}
          aria-current={tone === "on" ? "true" : undefined}
          className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-2 text-left transition hover:bg-zinc-800/50 ${focusRing}`}
        >
          {slot.kind === "break" ? (
            <Mic className="size-3.5 shrink-0 opacity-70" strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <Chip>{KIND_LABEL[slot.kind]}</Chip>
          )}
          <span className="min-w-0 flex-1 truncate text-sm">
            <span className={tone === "on" ? "" : "text-zinc-200"}>{track.name}</span>
            <span className={tone === "ahead" ? "text-zinc-500" : "opacity-70"}>
              {" "}
              · {track.artists.join(", ")}
            </span>
          </span>
          {slot.fallback && (
            <span
              title={slot.fallback.reason}
              className="shrink-0 rounded-full border border-amber-700/60 bg-amber-900/30 px-1.5 py-px font-mono text-[10px] text-amber-300"
            >
              {slot.fallback.from} → {slot.fallback.to}
            </span>
          )}
          <span className="font-mono text-xs tabular-nums opacity-50">{clock(track.durationMs)}</span>
        </button>
        {onRetake && (
          <button
            type="button"
            onClick={onRetake}
            disabled={retaking}
            aria-label={retaking ? "Voicing again" : "Voice this slot again"}
            title={retaking ? "Voicing again…" : "Voice again, with the settings as they are now"}
            className={`mt-1.5 rounded-full p-1 transition ${
              retaking ? "text-lamp" : "text-zinc-600 hover:text-zinc-200"
            } ${focusRing}`}
          >
            <RefreshCw
              className={`size-3.5 ${retaking ? "animate-[spin_1.6s_linear_infinite]" : ""}`}
              strokeWidth={1.75}
              aria-hidden="true"
            />
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Hide detail" : "Show detail"}
          aria-expanded={open}
          className={`mt-1.5 rounded-full p-1 text-zinc-500 transition hover:text-zinc-200 ${focusRing}`}
        >
          <ChevronDown className={`size-4 transition ${open ? "rotate-180" : ""}`} strokeWidth={1.75} />
        </button>
      </div>
      {open && <Detail slot={slot} />}
    </div>
  );
}

/** The words as written, the writer's numbers, the card's intro, the fallback and its reason. Nothing editable. */
function Detail({ slot }: { slot: Slot }) {
  const numbers: [string, number | undefined][] = [
    ["record under", slot.recordUnderMs],
    ["voice in", slot.voiceInMs],
    ["intro", slot.introMs],
  ];
  return (
    <div className="mb-2 ml-4 flex flex-col gap-2 rounded-lg border border-zinc-800/70 bg-zinc-950/60 px-3 py-2.5 text-xs text-zinc-400">
      {slot.legalId && <p className="font-mono text-[12px] italic text-zinc-500">{slot.legalId}</p>}
      {slot.words && (
        <p className="whitespace-pre-line font-mono text-[12px] leading-relaxed text-zinc-300">
          {slot.words}
        </p>
      )}
      {slot.leadLine && (
        <p className="whitespace-pre-line font-mono text-[12px] italic leading-relaxed text-zinc-300">
          {slot.leadLine}
        </p>
      )}
      {slot.kind === "segue" && !slot.words && <p className="text-zinc-500">straight in</p>}
      <p className="flex flex-wrap gap-x-4 gap-y-1 font-mono tabular-nums">
        {numbers.map(
          ([k, v]) =>
            v !== undefined && (
              <span key={k}>
                {k} {secs(v)}
              </span>
            ),
        )}
        <span>{slot.voiced ? (slot.clipKey ? takeOf(slot.clipKey) : "no clip") : "not voiced yet"}</span>
      </p>
      <p className="text-zinc-500">{slot.why}</p>
      {slot.fallback && (
        <p className="text-amber-300/90">
          {slot.fallback.from} → {slot.fallback.to}: {slot.fallback.reason}
        </p>
      )}
    </div>
  );
}

/** The first take's key is `<seq>.mp3`; a later take's carries a marker after the seq. */
const takeOf = (clipKey: string) => (/-[^/]+\.mp3$/.test(clipKey) ? "voiced again" : "voiced");

/** A record whose slot hasn't been written: what will play, in the dim tone. */
function ToCome({ track, label }: { track: Track; label: string }) {
  return (
    <div className="rail-row flex items-center gap-2.5 py-2 pr-2 pl-4 text-zinc-500">
      <Chip>{label}</Chip>
      <span className="min-w-0 flex-1 truncate text-sm">
        <span className="text-zinc-300">{track.name}</span> · {track.artists.join(", ")}
      </span>
      <span className="font-mono text-xs tabular-nums opacity-50">{clock(track.durationMs)}</span>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 rounded-[3px] bg-zinc-800 px-1.5 py-px font-mono text-[10px] uppercase tracking-widest text-zinc-400">
      {children}
    </span>
  );
}
