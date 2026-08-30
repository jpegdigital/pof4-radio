import type { Playback } from "@/components/station/use-spotify-device";
import { clipOf, type Element, type Level, type ProgramState } from "./reducer";
import { type ClipEntry, type MicClock, TAIL_MS } from "./use-program";

/**
 * The cue sheet as a timeline: one row per element, two lane bars — music (width = the track or
 * bed's length, colour = its level) and mic (width = the clip's measured length, pushed to the
 * end for an outro) — a live hairline on each lane for the element on air, and any row tappable.
 */

const LEVEL_CLASS: Record<Level, string> = {
  off: "bg-zinc-800",
  bed: "bg-sky-900",
  duck: "bg-sky-700",
  full: "bg-sky-500",
};

export function Timeline({
  elements,
  state,
  clips,
  micClock,
  playback,
  onJump,
}: {
  elements: Element[];
  state: ProgramState;
  clips: ReadonlyMap<string, ClipEntry>;
  micClock: MicClock | null;
  playback: Playback | null;
  onJump: (index: number) => void;
}) {
  return (
    <ol className="flex flex-col gap-2">
      {elements.map((el, i) => (
        <Row
          key={`${i}-${clipOf(el) ?? el.kind}`}
          el={el}
          live={state.cursor === i}
          state={state}
          clip={clipEntry(el, clips)}
          micClock={micClock}
          playback={playback}
          onTap={() => onJump(i)}
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
  live,
  state,
  clip,
  micClock,
  playback,
  onTap,
}: {
  el: Element;
  live: boolean;
  state: ProgramState;
  clip: ClipEntry | null;
  micClock: MicClock | null;
  playback: Playback | null;
  onTap: () => void;
}) {
  const clipLen = clip && "url" in clip ? clip.durationMs : null;
  const musicLen =
    el.kind === "song" ? el.track.durationMs : el.kind === "break" ? (el.bed?.durationMs ?? 0) : 0;
  const total = Math.max(musicLen, clipLen ?? 0, 1);
  const pct = (ms: number) => `${(ms / total) * 100}%`;
  const outro = el.kind === "song" && el.talk?.over === "outro";
  const musicLevel: Level = live ? state.music.level : restingLevel(el);
  const musicPos = live && playback && playback.uri === state.music.uri ? playback.position : null;
  const micOn = live && state.mic !== null;

  return (
    <li>
      <button
        type="button"
        onClick={onTap}
        className={`w-full rounded-xl border p-3 text-left transition ${
          live ? "border-lamp/60 bg-zinc-900" : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
        }`}
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate font-medium">{title(el)}</span>
          <span className="shrink-0 font-mono text-xs text-zinc-500">
            {musicLen > 0 && fmt(musicLen)}
            {clipLen !== null && ` · mic ${fmt(clipLen)}`}
            {clip && "error" in clip && " · no clip"}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-[3rem_1fr] items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase text-zinc-500">
          <span>music</span>
          <div className="relative h-2 overflow-hidden rounded bg-zinc-800">
            {musicLen > 0 && (
              <div className={`h-full ${LEVEL_CLASS[musicLevel]}`} style={{ width: pct(musicLen) }} />
            )}
            {musicPos !== null && (
              <div className="absolute top-0 h-full w-px bg-white" style={{ left: pct(musicPos) }} />
            )}
          </div>
          <span>mic</span>
          <div className="relative h-2 overflow-hidden rounded bg-zinc-800">
            {clipLen !== null && (
              <div
                className={`h-full bg-lamp ${micOn ? "opacity-100" : "opacity-50"}`}
                style={{
                  width: pct(clipLen),
                  marginLeft: outro ? pct(Math.max(0, musicLen - clipLen - TAIL_MS)) : 0,
                }}
              />
            )}
            {micOn && micClock && (
              <div className="absolute top-0 h-full w-px bg-white" style={{ left: pct(micClock.position) }} />
            )}
          </div>
        </div>
      </button>
    </li>
  );
}

/** The level a row shows when it isn't on air: what its music lane will do first. */
function restingLevel(el: Element): Level {
  if (el.kind === "song") return el.talk?.over === "intro" ? "duck" : "full";
  return el.kind === "break" && el.bed ? "bed" : "off";
}

function title(el: Element): string {
  if (el.kind === "song") {
    const talk = el.talk ? ` · talk-up over the ${el.talk.over}` : " · straight in";
    return `${el.track.artists.join(", ")} — ${el.track.name}${talk}`;
  }
  return `${el.label}${el.kind === "break" && el.bed ? " · bed under" : " · dry"}`;
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
