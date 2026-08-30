import type { MouseEvent } from "react";
import type { Playback } from "@/components/station/use-spotify-device";
import type { Note } from "./make/shapes";
import { clipOf, type Element, type Level, type ProgramState } from "./reducer";
import { type ClipEntry, type MicClock, TAIL_MS } from "./use-program";

/**
 * The cue sheet as a timeline: one row per element, two lane bars — music (width = the track or
 * bed's length, colour = its level) and mic (width = the clip's measured length, pushed to the
 * end for an outro) — a live hairline on each lane for the element on air. The title puts the
 * element on air; a click on a lane bar scrubs to that point (on another row: goes there first).
 */

const LEVEL_CLASS: Record<Level, string> = {
  off: "bg-zinc-800",
  duck: "bg-sky-700",
  full: "bg-sky-500",
};

export interface Seek {
  index: number;
  lane: "music" | "mic";
  ms: number;
}

export function Timeline({
  elements,
  notes = [],
  state,
  clips,
  micClock,
  playback,
  onJump,
  onSeek,
}: {
  elements: Element[];
  /** The maker's notes: what each clip is, what it says, how it was timed (by element index). */
  notes?: Note[];
  state: ProgramState;
  clips: ReadonlyMap<string, ClipEntry>;
  micClock: MicClock | null;
  playback: Playback | null;
  onJump: (index: number) => void;
  onSeek: (seek: Seek) => void;
}) {
  const noteOf = new Map(notes.map((n) => [n.element, n]));
  return (
    <ol className="flex flex-col gap-2">
      {elements.map((el, i) => (
        <Row
          key={`${i}-${clipOf(el) ?? el.kind}`}
          el={el}
          note={noteOf.get(i) ?? null}
          live={state.cursor === i}
          state={state}
          clip={clipEntry(el, clips)}
          micClock={micClock}
          playback={playback}
          onTap={() => onJump(i)}
          onSeek={(lane, ms) => onSeek({ index: i, lane, ms })}
        />
      ))}
    </ol>
  );
}

function clipEntry(el: Element, clips: ReadonlyMap<string, ClipEntry>): ClipEntry | null {
  const name = clipOf(el);
  return name ? (clips.get(name) ?? null) : null;
}

function Row({
  el,
  note,
  live,
  state,
  clip,
  micClock,
  playback,
  onTap,
  onSeek,
}: {
  el: Element;
  note: Note | null;
  live: boolean;
  state: ProgramState;
  clip: ClipEntry | null;
  micClock: MicClock | null;
  playback: Playback | null;
  onTap: () => void;
  onSeek: (lane: "music" | "mic", ms: number) => void;
}) {
  const clipLen = clip && "url" in clip ? clip.durationMs : null;
  // A break's axis is its clip; the bed runs from `bedInMs` to the lead. A song's axis is the track.
  const isBreak = el.kind === "break";
  const musicStart = isBreak ? (el.bedInMs ?? 0) : 0;
  const musicLen = isBreak
    ? el.bed && clipLen !== null
      ? Math.max(0, clipLen - el.leadMs - musicStart)
      : 0
    : el.track.durationMs;
  const total = Math.max(isBreak ? (clipLen ?? 1) : musicLen, 1);
  const pct = (ms: number) => `${(ms / total) * 100}%`;
  const outro = el.kind === "song" && el.talk?.over === "outro";
  const micStart = outro && clipLen !== null ? Math.max(0, musicLen - clipLen - TAIL_MS) : 0;
  const musicLevel: Level = live ? state.music.level : restingLevel(el);
  const micOn = live && state.mic !== null;
  const musicPos = isBreak
    ? micOn && micClock
      ? micClock.position
      : null
    : live && playback && playback.uri === state.music.uri
      ? playback.position
      : null;

  /** Where on the row's time axis a click landed, in ms. */
  const at = (e: MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * total;
  };

  return (
    <li
      className={`rounded-xl border p-3 transition ${
        live ? "border-lamp/60 bg-zinc-900" : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <button type="button" onClick={onTap} className="truncate text-left font-medium hover:text-lamp">
          {title(el)}
        </button>
        <span className="shrink-0 font-mono text-xs text-zinc-500">
          {!isBreak && fmt(musicLen)}
          {clipLen !== null && ` · mic ${fmt(clipLen)}`}
          {clip && "error" in clip && " · no clip"}
        </span>
      </div>
      {note && <NoteLine note={note} />}
      <div className="mt-2 grid grid-cols-[3rem_1fr] items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase text-zinc-500">
        <span>music</span>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: a scrub strip; the title is the keyboard path */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: same */}
        <div
          className={`relative h-3 overflow-hidden rounded bg-zinc-800 ${musicLen > 0 ? "cursor-pointer" : ""}`}
          onClick={(e) => !isBreak && musicLen > 0 && onSeek("music", Math.min(at(e), musicLen))}
        >
          {musicLen > 0 && (
            <div
              className={`h-full ${isBreak ? "bg-sky-900" : LEVEL_CLASS[musicLevel]}`}
              style={{ width: pct(musicLen), marginLeft: pct(musicStart) }}
            />
          )}
          {musicPos !== null && (
            <div className="absolute top-0 h-full w-0.5 bg-white" style={{ left: pct(musicPos) }} />
          )}
        </div>
        <span>mic</span>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: a scrub strip */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: same */}
        <div
          className={`relative h-3 overflow-hidden rounded bg-zinc-800 ${clipLen !== null ? "cursor-pointer" : ""}`}
          onClick={(e) => clipLen !== null && onSeek("mic", Math.min(Math.max(0, at(e) - micStart), clipLen))}
        >
          {clipLen !== null && (
            <div
              className={`h-full bg-lamp ${micOn ? "opacity-100" : "opacity-50"}`}
              style={{ width: pct(clipLen), marginLeft: pct(micStart) }}
            />
          )}
          {micOn && micClock && (
            <div
              className="absolute top-0 h-full w-0.5 bg-white"
              style={{ left: pct(micStart + micClock.position) }}
            />
          )}
        </div>
      </div>
    </li>
  );
}

/** The maker's note under a row: the treatment, a fallback badge (the reason on hover), the words. */
function NoteLine({ note }: { note: Note }) {
  return (
    <div className="mt-1 flex flex-wrap items-baseline gap-2 text-xs text-zinc-500">
      <span className="font-mono uppercase tracking-widest text-zinc-400">{note.treatment}</span>
      {note.fallback && (
        <span
          title={note.fallback.reason}
          className="rounded-full border border-amber-700/60 bg-amber-900/30 px-2 py-0.5 font-mono text-amber-300"
        >
          {note.fallback.from} → {note.fallback.to}
        </span>
      )}
      {note.words && (
        <details className="min-w-0 flex-1">
          <summary className="cursor-pointer truncate text-zinc-500 hover:text-zinc-300">
            {note.words}
          </summary>
          <p className="mt-1 whitespace-pre-line leading-relaxed text-zinc-300">{note.words}</p>
        </details>
      )}
    </div>
  );
}

/** The level a row shows when it isn't on air: what its music lane will do first. */
function restingLevel(el: Element): Level {
  if (el.kind === "song") return el.talk?.over === "intro" && !el.talk.atMs ? "duck" : "full";
  return "off";
}

function title(el: Element): string {
  if (el.kind === "song") {
    const talk = el.talk
      ? ` · talk-up over the ${el.talk.over}${el.talk.atMs ? ` from ${(el.talk.atMs / 1000).toFixed(1)} s` : ""}`
      : " · straight in";
    return `${el.track.artists.join(", ")} — ${el.track.name}${talk}`;
  }
  const bed = el.bed ? (el.bedInMs ? " · dry, then bed under" : " · bed under") : " · dry";
  return `${el.label}${bed}${el.leadMs ? " · talks the next song in" : " · hard intro"}`;
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
