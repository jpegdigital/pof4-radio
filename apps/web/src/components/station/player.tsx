import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useEffect, useState } from "react";
import { focusRing } from "./ui";

/**
 * The transport. Talk and track are the same frame — art slot, three lines, a progress line,
 * three buttons — so the show reads as one sequence. Position is interpolated from the last
 * report while playing; both Spotify and the audio element only report on change.
 */

export interface Clock {
  paused: boolean;
  /** ms as of `at` (performance.now()). */
  position: number;
  duration: number;
  at: number;
}

export type PlayerFace =
  | { kind: "track"; name: string; artists: string[]; album: string; image: string | null; playback: Clock }
  /** `playback` null = the voice is still loading. */
  | { kind: "talk"; dj: string; initial: string; seq: number; excerpt: string; playback: Clock | null }
  | { kind: "planning"; dj: string };

export function Player({
  face,
  running,
  canPrev,
  canNext,
  onPrev,
  onNext,
  onToggle,
}: {
  face: PlayerFace;
  running: boolean;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToggle: () => void;
}) {
  const clock = face.kind === "planning" ? null : face.playback;
  const paused = !running || (clock?.paused ?? true);
  const canToggle = running && face.kind !== "planning" && clock !== null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <Art face={face} playing={!paused} />
        <div className="min-w-0 flex-1">
          {face.kind === "track" && (
            <>
              <div className="truncate text-base font-medium">{face.name}</div>
              <div className="truncate text-sm text-zinc-400">{face.artists.join(", ")}</div>
              <div className="truncate text-xs text-zinc-500">{face.album}</div>
            </>
          )}
          {face.kind === "talk" && (
            <>
              <div className="truncate text-base font-medium">{face.dj} on the mic</div>
              <div className="truncate text-sm text-zinc-400">Block {face.seq}</div>
              <div className="truncate font-mono text-xs text-zinc-500">{face.excerpt}</div>
            </>
          )}
          {face.kind === "planning" && (
            <>
              <div className="truncate text-base font-medium">Next block</div>
              <div className="truncate text-sm text-zinc-400">{face.dj} is picking the tracks…</div>
            </>
          )}
        </div>
      </div>

      {clock ? (
        <Progress clock={clock} live={!paused} />
      ) : (
        <Loading label={face.kind === "talk" ? "loading voice…" : ""} />
      )}

      <div className="flex items-center justify-center gap-6">
        <button
          type="button"
          onClick={onPrev}
          disabled={!running || !canPrev}
          aria-label="Previous"
          className={iconBtn}
        >
          <SkipBack className="size-6" fill="currentColor" strokeWidth={0} />
        </button>
        <button
          type="button"
          onClick={onToggle}
          disabled={!canToggle}
          aria-label={paused ? "Play" : "Pause"}
          className={`flex size-14 items-center justify-center rounded-full bg-zinc-100 text-black transition hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100 ${focusRing}`}
        >
          {paused ? (
            <Play className="ml-0.5 size-6" fill="currentColor" strokeWidth={0} />
          ) : (
            <Pause className="size-6" fill="currentColor" strokeWidth={0} />
          )}
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!running || !canNext}
          aria-label="Next"
          className={iconBtn}
        >
          <SkipForward className="size-6" fill="currentColor" strokeWidth={0} />
        </button>
      </div>
    </div>
  );
}

const iconBtn = `rounded-full p-2 text-zinc-300 transition hover:text-white active:scale-95 disabled:opacity-30 disabled:hover:text-zinc-300 ${focusRing}`;

/** The art slot: album art for a track; the DJ's initial on amber for a talk; the lamp while planning. */
function Art({ face, playing }: { face: PlayerFace; playing: boolean }) {
  if (face.kind === "track") {
    return face.image ? (
      // biome-ignore lint/performance/noImgElement: album art is a remote Spotify CDN url
      <img src={face.image} alt="" className="size-20 shrink-0 rounded-lg bg-zinc-800 object-cover" />
    ) : (
      <div className="size-20 shrink-0 rounded-lg bg-zinc-800" />
    );
  }
  if (face.kind === "talk") {
    return (
      <div
        aria-hidden="true"
        className={`lamp on ${playing ? "talking" : ""} flex size-20 shrink-0 items-center justify-center rounded-lg font-display text-5xl font-semibold text-black`}
      >
        {face.initial}
      </div>
    );
  }
  return (
    <div className="flex size-20 shrink-0 items-center justify-center rounded-lg bg-zinc-800">
      <span aria-hidden="true" className="lamp on talking size-3 rounded-full" />
    </div>
  );
}

function Progress({ clock, live }: { clock: Clock; live: boolean }) {
  const position = useLivePosition(clock, live);
  const pct = clock.duration > 0 ? Math.min(100, (position / clock.duration) * 100) : 0;
  return (
    <div>
      <div className="h-1 overflow-hidden rounded-full bg-zinc-800">
        <div className="h-full bg-zinc-200" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[11px] tabular-nums text-zinc-500">
        <span>{fmt(position)}</span>
        <span>{fmt(clock.duration)}</span>
      </div>
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div>
      <div className="shimmer h-1 rounded-full" />
      <div className="mt-1 flex justify-between font-mono text-[11px] text-zinc-500">
        <span>{label}</span>
        <span>—</span>
      </div>
    </div>
  );
}

function useLivePosition(c: Clock, live: boolean): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(performance.now()), 500);
    return () => clearInterval(id);
  }, [live, c.at]);
  return live ? Math.min(c.duration, c.position + (now - c.at)) : c.position;
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
