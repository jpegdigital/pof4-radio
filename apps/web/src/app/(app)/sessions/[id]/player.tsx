import { Mic, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { type KeyboardEvent, type PointerEvent, useState } from "react";
import { focusRing } from "../../lib/ui";
import type { Plan } from "./plan";
import { onMic } from "./transport";
import { type Cue, clock, KIND_LABEL, secs } from "./types";
import type { DeckPhase, RecordClock } from "./use-deck";

/**
 * The transport, lifted from the old station: the art slot, three lines, a progress line, three
 * buttons — the voice and the record share the frame so the show reads as one sequence. New in
 * this one: the cue, three lanes on one scale — the mic, the bed with its ramps, the record up
 * to its vocal, dimmed where it is ducked under the voice — with the head sweeping across while
 * the slot's mix runs; drag it to scrub the mix. The record's own clock is its element's, read by
 * the deck every frame, and scrubs the record.
 */

/** A keyboard nudge on either scrubber. */
const NUDGE_MS = 1000;

export function Player({
  cue,
  phase,
  plan,
  headMs,
  record,
  canPrev,
  canNext,
  onPrev,
  onNext,
  onToggle,
  onScrub,
  onSeekRecord,
}: {
  cue: Cue;
  phase: DeckPhase;
  plan: Plan | null;
  headMs: number;
  record: RecordClock | null;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToggle: () => void;
  /** Move the head on the cue. */
  onScrub: (ms: number) => void;
  /** Move within the record. */
  onSeekRecord: (ms: number) => void;
}) {
  const { slot, track } = cue;
  const making = phase === "voicing" || phase === "loading";
  const running = phase === "playing" || phase === "paused";
  const talking = plan !== null && running && onMic(plan, headMs);
  const paused = phase !== "playing";
  const rec = record ?? { positionMs: 0, durationMs: track.durationMs, playing: false };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        {talking || making ? (
          <div
            aria-hidden="true"
            className={`lamp on ${talking && !paused ? "talking" : ""} flex size-20 shrink-0 items-center justify-center rounded-lg text-black`}
          >
            <Mic className="size-8" strokeWidth={1.75} />
          </div>
        ) : track.image ? (
          // biome-ignore lint/performance/noImgElement: album art is a remote Qobuz CDN url
          <img src={track.image} alt="" className="size-20 shrink-0 rounded-lg bg-zinc-800 object-cover" />
        ) : (
          <div className="size-20 shrink-0 rounded-lg bg-zinc-800" />
        )}
        <div className="min-w-0 flex-1">
          {talking || making ? (
            <>
              <div className="truncate text-base font-medium">On the mic</div>
              <div className="truncate text-sm text-zinc-400">
                {KIND_LABEL[slot.kind]} · into {track.name}
              </div>
              <div className="truncate font-mono text-xs text-zinc-500">
                {slot.words ?? slot.legalId ?? ""}
              </div>
            </>
          ) : (
            <>
              <div className="truncate text-base font-medium">{track.name}</div>
              <div className="truncate text-sm text-zinc-400">{track.artists.join(", ")}</div>
              <div className="truncate text-xs text-zinc-500">{track.album}</div>
            </>
          )}
        </div>
      </div>

      {plan ? (
        <Lanes
          plan={plan}
          headMs={running ? headMs : null}
          track={track}
          onScrub={running ? onScrub : null}
        />
      ) : making ? (
        <Loading label={phase === "voicing" ? "voicing…" : "loading…"} />
      ) : null}

      <Progress clock={rec} onSeek={record && running ? onSeekRecord : null} />

      <div className="flex items-center justify-center gap-6">
        <button type="button" onClick={onPrev} disabled={!canPrev} aria-label="Previous" className={iconBtn}>
          <SkipBack className="size-6" fill="currentColor" strokeWidth={0} />
        </button>
        <button
          type="button"
          onClick={onToggle}
          disabled={making}
          aria-label={paused ? "Play" : "Pause"}
          className={`flex size-14 items-center justify-center rounded-full bg-zinc-100 text-black transition hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100 ${focusRing}`}
        >
          {paused ? (
            <Play className="ml-0.5 size-6" fill="currentColor" strokeWidth={0} />
          ) : (
            <Pause className="size-6" fill="currentColor" strokeWidth={0} />
          )}
        </button>
        <button type="button" onClick={onNext} disabled={!canNext} aria-label="Next" className={iconBtn}>
          <SkipForward className="size-6" fill="currentColor" strokeWidth={0} />
        </button>
      </div>
    </div>
  );
}

const iconBtn = `rounded-full p-2 text-zinc-300 transition hover:text-white active:scale-95 disabled:opacity-30 disabled:hover:text-zinc-300 ${focusRing}`;

/**
 * A strip you can scrub: pointer down and drag shows where you are (`drag`), letting go
 * commits it; arrow keys nudge. Null handlers when there is nothing to scrub yet.
 */
function useScrub(lengthMs: number, onCommit: ((ms: number) => void) | null) {
  const [drag, setDrag] = useState<number | null>(null);
  const msAt = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * lengthMs;
  };
  const handlers = onCommit
    ? {
        onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag(msAt(e));
        },
        onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
          if (drag !== null) setDrag(msAt(e));
        },
        onPointerUp: (e: PointerEvent<HTMLDivElement>) => {
          if (drag === null) return;
          setDrag(null);
          onCommit(msAt(e));
        },
        onPointerCancel: () => setDrag(null),
        onKeyDown: (e: KeyboardEvent<HTMLDivElement>, at: number) => {
          if (e.key === "ArrowLeft") onCommit(Math.max(0, at - NUDGE_MS));
          else if (e.key === "ArrowRight") onCommit(Math.min(lengthMs, at + NUDGE_MS));
          else return;
          e.preventDefault();
        },
      }
    : null;
  return { drag, handlers };
}

/** The cue: three lanes on one scale — the mic in the lamp's amber, the bed with its ramps, the record to its vocal — and the head. */
function Lanes({
  plan,
  headMs,
  track,
  onScrub,
}: {
  plan: Plan;
  headMs: number | null;
  track: { name: string };
  onScrub: ((ms: number) => void) | null;
}) {
  const pct = (ms: number) => `${Math.min(100, Math.max(0, (ms / plan.lengthMs) * 100))}%`;
  const ticks: number[] = [];
  for (let t = 0; t <= plan.lengthMs; t += 5000) ticks.push(t);
  const lane = "relative h-5 overflow-hidden rounded bg-zinc-800/60";
  const bed = plan.bed;
  const bedSpan = bed ? bed.outMs - bed.atMs : 0;
  const { drag, handlers } = useScrub(plan.lengthMs, onScrub);
  const head = drag ?? headMs;
  return (
    <div>
      <div className="flex gap-2 font-display text-[10px] uppercase tracking-[0.18em] text-zinc-500">
        <div className="flex w-9 shrink-0 flex-col gap-1">
          <span className="h-5 leading-5">mic</span>
          <span className="h-5 leading-5">bed</span>
          <span className="h-5 leading-5">rec</span>
        </div>
        <div
          role="slider"
          aria-label="The cue"
          aria-valuemin={0}
          aria-valuemax={Math.round(plan.lengthMs / 1000)}
          aria-valuenow={Math.round((head ?? 0) / 1000)}
          aria-valuetext={secs(head ?? 0)}
          tabIndex={onScrub ? 0 : -1}
          className={`relative flex min-w-0 flex-1 touch-none select-none flex-col gap-1 rounded ${onScrub ? "cursor-ew-resize" : ""} ${focusRing}`}
          onPointerDown={handlers?.onPointerDown}
          onPointerMove={handlers?.onPointerMove}
          onPointerUp={handlers?.onPointerUp}
          onPointerCancel={handlers?.onPointerCancel}
          onKeyDown={handlers ? (e) => handlers.onKeyDown(e, head ?? 0) : undefined}
        >
          <div className={lane}>
            {plan.mic && (
              <div
                className="absolute inset-y-0 rounded bg-lamp/85"
                style={{ left: pct(plan.mic.atMs), width: pct(plan.mic.endMs - plan.mic.atMs) }}
                title={`voice ${secs(plan.mic.atMs)} → ${secs(plan.mic.endMs)}`}
              />
            )}
          </div>
          <div className={lane}>
            {bed && (
              <div
                className="absolute inset-y-0 rounded"
                style={{
                  left: pct(bed.atMs),
                  width: pct(bedSpan),
                  background: `linear-gradient(to right, transparent, rgb(113 113 122) ${(
                    ((bed.fullMs - bed.atMs) / bedSpan) * 100
                  ).toFixed(
                    1,
                  )}%, rgb(113 113 122) ${(((bed.downMs - bed.atMs) / bedSpan) * 100).toFixed(1)}%, transparent)`,
                }}
                title={`bed in ${secs(bed.atMs)}, full ${secs(bed.fullMs)}, down ${secs(bed.downMs)}, out ${secs(bed.outMs)}`}
              />
            )}
          </div>
          <div className={lane}>
            {plan.duck && (
              <div
                className="absolute inset-y-0 z-10 border-x border-zinc-950/60 bg-zinc-950/45"
                style={{ left: pct(plan.duck.atMs), width: pct(plan.duck.endMs - plan.duck.atMs) }}
                title={`ducked under the voice ${secs(plan.duck.atMs)} → ${secs(plan.duck.endMs)}`}
              />
            )}
            {plan.vocalMs !== undefined ? (
              <>
                <div
                  className="absolute inset-y-0 rounded-l bg-zinc-500"
                  style={{ left: pct(plan.music.atMs), width: pct(plan.vocalMs - plan.music.atMs) }}
                  title={`${track.name} at ${secs(plan.music.atMs)}, intro to ${secs(plan.vocalMs)}`}
                />
                <div
                  className="absolute inset-y-0 right-0 rounded-r bg-zinc-300"
                  style={{ left: pct(plan.vocalMs) }}
                  title={`vocal at ${secs(plan.vocalMs)}`}
                />
              </>
            ) : (
              <div
                className="absolute inset-y-0 right-0 rounded bg-zinc-300"
                style={{ left: pct(plan.music.atMs) }}
                title={`${track.name} at ${secs(plan.music.atMs)}`}
              />
            )}
          </div>
          <div className="relative h-3 font-mono normal-case tracking-normal text-zinc-600">
            {ticks.map((t) => (
              <span key={t} className="absolute -translate-x-1/2" style={{ left: pct(t) }}>
                {t / 1000}
              </span>
            ))}
            {plan.vocalMs !== undefined && (
              <span
                className="absolute -translate-x-1/2 bg-zinc-950 px-1 font-display uppercase tracking-[0.18em] text-zinc-400"
                style={{ left: pct(plan.vocalMs) }}
              >
                vocal
              </span>
            )}
          </div>
          {head !== null && (
            <div
              className="pointer-events-none absolute top-0 bottom-4 w-px bg-white"
              style={{ left: pct(head) }}
            />
          )}
        </div>
      </div>
      {plan.note && <p className="mt-1 text-xs text-amber-300/90">{plan.note}</p>}
    </div>
  );
}

/** The record's clock, as the deck reads it each frame; a scrub moves within the record. */
function Progress({ clock: c, onSeek }: { clock: RecordClock; onSeek: ((ms: number) => void) | null }) {
  const { drag, handlers } = useScrub(c.durationMs, onSeek);
  const shown = drag ?? c.positionMs;
  const pct = c.durationMs > 0 ? Math.min(100, (shown / c.durationMs) * 100) : 0;
  return (
    <div>
      <div
        role="slider"
        aria-label="The record"
        aria-valuemin={0}
        aria-valuemax={Math.round(c.durationMs / 1000)}
        aria-valuenow={Math.round(shown / 1000)}
        aria-valuetext={clock(shown)}
        tabIndex={onSeek ? 0 : -1}
        className={`touch-none select-none rounded py-1.5 ${onSeek ? "cursor-ew-resize" : ""} ${focusRing}`}
        onPointerDown={handlers?.onPointerDown}
        onPointerMove={handlers?.onPointerMove}
        onPointerUp={handlers?.onPointerUp}
        onPointerCancel={handlers?.onPointerCancel}
        onKeyDown={handlers ? (e) => handlers.onKeyDown(e, shown) : undefined}
      >
        <div className="h-1 overflow-hidden rounded-full bg-zinc-800">
          <div className="h-full bg-zinc-200" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="flex justify-between font-mono text-[11px] tabular-nums text-zinc-500">
        <span>{clock(shown)}</span>
        <span>{clock(c.durationMs)}</span>
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
