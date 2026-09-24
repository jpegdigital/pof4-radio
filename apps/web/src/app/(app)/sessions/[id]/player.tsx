import { Disc3, Mic, Pause, Play, SkipBack, SkipForward, SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { useScrub } from "@/components/use-scrub";
import type { ScrubSnapshot } from "@/components/scrub";
import type { Preparation } from "./preparation";
import { focusRing } from "../../lib/ui";
import type { Plan } from "@/lib/playback/plan";
import { onMic } from "./transport";
import { type Cue, clock, type DeckPhase, secs, type TrackClock } from "./types";

/**
 * The transport, lifted from the old station: the art slot, three lines, a progress line, three
 * buttons — the voice and the track share the frame so the show reads as one sequence. New in
 * this one: the cue, three lanes on one scale — the mic, the bed with its ramps, the track up
 * to its vocal, dimmed where it is ducked under the voice — with the head sweeping across while
 * the slot's mix runs; drag it to scrub the mix. The track's own clock is its element's, read by
 * the deck every frame, and scrubs the track.
 */

const MIXER_STATUS: Record<DeckPhase, string> = {
  idle: "STANDBY",
  loading: "LOADING",
  seeking: "SEEKING",
  playing: "ON AIR",
  paused: "PAUSED",
  held: "INTERRUPTED",
  waiting: "UP NEXT",
  error: "STOPPED",
};

export function Player({
  cue,
  phase,
  plan,
  headMs,
  track,
  canPrev,
  canNext,
  onPrev,
  onNext,
  onToggle,
  onScrub,
  onSeekTrack,
  preparation,
  startup,
  playbackId,
  operationId,
  intent,
}: {
  cue: Cue;
  phase: DeckPhase;
  plan: Plan | null;
  headMs: number;
  track: TrackClock | null;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToggle: () => void;
  /** Move the head on the cue. */
  onScrub: (ms: number) => number | null;
  /** Move within the track. */
  onSeekTrack: (ms: number) => number | null;
  preparation: Preparation;
  startup?: ReactNode;
  playbackId: string;
  operationId: number;
  intent: "play" | "pause";
}) {
  const { pick } = cue;
  const making = phase === "loading" || !preparation.ready;
  const running = phase === "playing" || phase === "paused" || phase === "held" || phase === "seeking";
  const talking = plan !== null && running && onMic(plan, headMs);
  const paused = intent === "pause" || phase === "idle" || phase === "error";
  const scrub = { cueId: playbackId, operationId, seeking: phase === "seeking" };
  const rec = track ?? { positionMs: 0, durationMs: pick.durationMs, playing: false };

  return (
    <div className="flex flex-col gap-4">
      {making && startup}
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="player-art">
          {pick.image ? (
            // eslint-disable-next-line @next/next/no-img-element -- album art is a remote Qobuz CDN url
            <img
              src={pick.image}
              alt={`${pick.album} album cover`}
              className="aspect-square w-full rounded-xl bg-zinc-800 object-cover shadow-2xl"
            />
          ) : (
            <div className="record-placeholder flex aspect-square items-center justify-center rounded-xl">
              <Disc3 className="size-20 text-lamp/60" strokeWidth={1} aria-hidden="true" />
            </div>
          )}
          {talking && !paused && (
            <span className="absolute right-3 bottom-3 left-3 flex items-center justify-center gap-2 rounded-lg bg-zinc-950/90 px-3 py-2 text-xs text-lamp">
              <Mic className="size-3.5" aria-hidden="true" /> Your DJ is on the mic
            </span>
          )}
        </div>
        <div className="w-full min-w-0">
          <h1 className="player-title">{pick.title}</h1>
          <p className="mt-1.5 text-sm text-zinc-300">{pick.artists.join(", ")}</p>
          <p className="player-album mt-1">{pick.album}</p>
        </div>
      </div>

      {(!startup || !making) &&
        (making ? (
          phase === "loading" || preparation.busy ? (
            <Loading label={phase === "loading" ? "Loading audio…" : preparation.label} />
          ) : (
            <p className="text-center text-sm text-amber-200">{preparation.label}</p>
          )
        ) : (
          <Progress clock={rec} scrub={scrub} onSeek={track && running ? onSeekTrack : null} />
        ))}

      <div className="player-transport">
        <button type="button" onClick={onPrev} disabled={!canPrev} aria-label="Previous" className={iconBtn}>
          <SkipBack className="size-6" fill="currentColor" strokeWidth={0} />
        </button>
        <button
          type="button"
          onClick={onToggle}
          disabled={making}
          aria-label={phase === "idle" ? "Play show" : paused ? "Play" : "Pause"}
          className={`player-play flex items-center justify-center gap-2 rounded-full px-5 text-zinc-950 transition hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100 ${focusRing}`}
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
      <section className="mixer-panel" aria-label="Live mixer">
        <div className="mixer-heading">
          <h2>
            <SlidersHorizontal className="size-4 text-lamp" aria-hidden="true" /> Live mixer
          </h2>
          <span>{MIXER_STATUS[phase]}</span>
        </div>
        {plan ? (
          <Lanes
            plan={plan}
            scrub={scrub}
            headMs={running ? headMs : null}
            track={pick}
            onScrub={running ? onScrub : null}
          />
        ) : (
          <div className="mixer-empty">
            <span>Voice</span>
            <i />
            <span>Bed</span>
            <i />
            <span>Music</span>
            <i />
          </div>
        )}
        <p className="mixer-caption">
          {plan
            ? "Voice, bed & music · Drag the timeline to hear the mix."
            : "Your voice, bed & music timeline appears when you press play."}
        </p>
      </section>
    </div>
  );
}

const iconBtn = `flex size-12 items-center justify-center rounded-full text-zinc-300 transition hover:text-white active:scale-95 disabled:opacity-30 disabled:hover:text-zinc-300 ${focusRing}`;

/** The cue: three lanes on one scale — the mic in the lamp's amber, the bed with its ramps, the track to its vocal — and the head. */
function Lanes({
  plan,
  headMs,
  track,
  onScrub,
  scrub,
}: {
  scrub: Pick<ScrubSnapshot, "cueId" | "operationId" | "seeking">;
  plan: Plan;
  headMs: number | null;
  track: { title: string };
  onScrub: ((ms: number) => number | null) | null;
}) {
  const pct = (ms: number) => `${Math.min(100, Math.max(0, (ms / plan.previewEndMs) * 100))}%`;
  const ticks: number[] = [];
  for (let t = 0; t <= plan.previewEndMs; t += Math.max(5000, Math.ceil(plan.previewEndMs / 5 / 5000) * 5000))
    ticks.push(t);
  const lane = "mixer-lane";
  const bed = plan.bed;
  const bedSpan = bed ? bed.outMs - bed.atMs : 0;
  const { shown, handlers } = useScrub(
    { ...scrub, positionMs: Math.min(plan.previewEndMs, headMs ?? 0), durationMs: plan.previewEndMs },
    onScrub,
  );
  const head = headMs === null ? null : shown;
  return (
    <div>
      <div className="flex gap-2 font-display text-[10px] uppercase tracking-[0.18em] text-zinc-500">
        <div className="mixer-labels flex shrink-0 flex-col gap-1">
          <span className="text-[#ffb29e]">Voice</span>
          <span className="text-[#b9a0e6]">Bed</span>
          <span className="text-[#8cdcd9]">Music</span>
        </div>
        <div
          role="slider"
          aria-label="Mix timeline"
          aria-disabled={!onScrub}
          aria-valuemin={0}
          aria-valuemax={Math.round(plan.previewEndMs / 1000)}
          aria-valuenow={Math.round((head ?? 0) / 1000)}
          aria-valuetext={secs(head ?? 0)}
          tabIndex={onScrub ? 0 : -1}
          className={`relative flex min-w-0 flex-1 touch-none select-none flex-col gap-1 rounded ${onScrub ? "cursor-ew-resize" : ""} ${focusRing}`}
          onPointerDown={handlers?.onPointerDown}
          onPointerMove={handlers?.onPointerMove}
          onPointerUp={handlers?.onPointerUp}
          onPointerCancel={handlers?.onPointerCancel}
          onLostPointerCapture={handlers?.onLostPointerCapture}
          onKeyDown={handlers?.onKeyDown}
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
                  background: `linear-gradient(to right, transparent, rgb(165 139 209) ${(
                    ((bed.fullMs - bed.atMs) / bedSpan) * 100
                  ).toFixed(
                    1,
                  )}%, rgb(165 139 209) ${(((bed.downMs - bed.atMs) / bedSpan) * 100).toFixed(1)}%, transparent)`,
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
                  className="absolute inset-y-0 rounded-l bg-[#62abae]"
                  style={{ left: pct(plan.music.atMs), width: pct(plan.vocalMs - plan.music.atMs) }}
                  title={`${track.title} at ${secs(plan.music.atMs)}, ramp to ${secs(plan.vocalMs)}`}
                />
                <div
                  className="absolute inset-y-0 right-0 rounded-r bg-[#8cdcd9]"
                  style={{ left: pct(plan.vocalMs) }}
                  title={`estimated cue at ${secs(plan.vocalMs)}`}
                />
              </>
            ) : (
              <div
                className="absolute inset-y-0 right-0 rounded bg-[#8cdcd9]"
                style={{ left: pct(plan.music.atMs) }}
                title={`${track.title} at ${secs(plan.music.atMs)}`}
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
    </div>
  );
}

/** The track's clock, as the deck reads it each frame; a scrub moves within the track. */
function Progress({
  clock: c,
  onSeek,
  scrub,
}: {
  clock: TrackClock;
  onSeek: ((ms: number) => number | null) | null;
  scrub: Pick<ScrubSnapshot, "cueId" | "operationId" | "seeking">;
}) {
  const { shown, handlers } = useScrub(
    { ...scrub, positionMs: c.positionMs, durationMs: c.durationMs },
    onSeek,
  );
  const pct = c.durationMs > 0 ? Math.min(100, (shown / c.durationMs) * 100) : 0;
  return (
    <div className="player-progress">
      <div
        role="slider"
        aria-label="Track progress"
        aria-disabled={!onSeek}
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
        onLostPointerCapture={handlers?.onLostPointerCapture}
        onKeyDown={handlers?.onKeyDown}
      >
        <div className="h-1 overflow-hidden rounded-full bg-zinc-800">
          <div className="h-full bg-zinc-200" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="time-labels flex justify-between font-mono text-[11px] tabular-nums text-zinc-500">
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
