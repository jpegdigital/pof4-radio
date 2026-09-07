import { ChevronDown, Disc3, RefreshCw } from "lucide-react";
import { useState } from "react";
import { focusRing, Label } from "../../lib/ui";
import { type Cue, clock, cueKey, isCue, KIND_LABEL, secs, type Slot } from "./types";

/**
 * The show as one list, in order. A proposed slot is a dim row — "coming up", the proposer's
 * title and artist, nothing to tap. A written slot paints the pick's tags, its kind (the mic
 * icon for a break), whether the bucket holds it yet, the on-air marker on the amber rail, and
 * behind a chevron the words, the lead line, the legal ID, the writer's numbers, the chart and
 * any fallback. A row goes in the deck on a tap once it is voiced and held; the arrows beside a
 * voiced row ask for another take of its clip, read with the roster as it stands now (the words
 * never change). The row being produced right now says so.
 */

export function Rundown({
  slots,
  producing,
  cursor,
  retaking,
  onPick,
  onRetake,
  playing,
  pullErrors,
  onRetryPull,
}: {
  slots: Slot[];
  /** What the page is producing right now: the slot (null for a fill) and the label. */
  producing: { seq: number | null; label: string } | null;
  /** The cue in the deck, if any. */
  cursor: string | null;
  /** The cue whose clip is being voiced again, if any. */
  retaking: string | null;
  onPick: (cue: Cue) => void;
  onRetake: (cue: Cue) => void;
  playing: boolean;
  pullErrors: Record<number, string>;
  onRetryPull: (seq: number) => void;
}) {
  const at = cursor === null ? -1 : slots.findIndex((s) => String(s.seq) === cursor);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <Label>The rundown</Label>
        <span className="font-mono text-xs text-zinc-500">{slots.length} tracks</span>
      </div>
      {producing?.seq === null && (
        <p role="status" className="text-sm text-zinc-400">
          {producing.label}
        </p>
      )}
      {slots.length === 0 && (
        <p className="rounded-xl border border-dashed border-zinc-800 p-6 text-sm leading-relaxed text-zinc-400">
          The first selections will appear here. Your DJ will keep the show going as you listen.
        </p>
      )}
      <ol className="flex flex-col">
        {slots.map((slot, i) => {
          const tone: Tone = at < 0 ? "ahead" : i === at ? "on" : i < at ? "played" : "ahead";
          const busy = producing?.seq === slot.seq ? producing.label : null;
          if (!isCue(slot)) return <ToCome key={slot.seq} slot={slot} label={busy ?? "coming up"} />;
          const key = cueKey(slot);
          return (
            <Row
              key={slot.seq}
              cue={slot}
              tone={tone}
              busy={busy}
              retaking={retaking === key}
              onTap={slot.voiced && slot.held ? () => onPick(slot) : null}
              onRetake={slot.voiced && slot.words ? () => onRetake(slot) : null}
              playing={playing}
              error={slot.held ? null : (pullErrors[slot.seq] ?? null)}
              onRetry={() => onRetryPull(slot.seq)}
            />
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
  cue,
  tone,
  busy,
  retaking,
  onTap,
  onRetake,
  playing,
  error,
  onRetry,
}: {
  cue: Cue;
  tone: Tone;
  /** What is happening to this row right now, if anything. */
  busy: string | null;
  retaking: boolean;
  /** Put it in the deck, or null while it cannot play yet. */
  onTap: (() => void) | null;
  /** Another take of the clip, or null when there is nothing said to read again. */
  onRetake: (() => void) | null;
  playing: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { pick } = cue;
  const marker = error
    ? "Download needs another try"
    : busy
      ? "Preparing…"
      : !cue.voiced
        ? "Preparing the DJ…"
        : !cue.held
          ? "Downloading…"
          : tone === "on"
            ? playing
              ? "Playing"
              : "Selected"
            : tone === "played"
              ? "Earlier"
              : "Ready to play";
  return (
    <li className={`rail-row ${tone === "ahead" ? "" : "lit"}`}>
      <div className={`flex w-full items-center gap-1 py-1 pl-4 ${TONE[tone]}`}>
        <button
          type="button"
          onClick={onTap ?? undefined}
          disabled={!onTap}
          aria-current={tone === "on" ? "true" : undefined}
          className={`flex min-w-0 flex-1 items-center gap-3 rounded-lg py-3 text-left transition enabled:hover:bg-zinc-800/50 disabled:cursor-default ${focusRing}`}
        >
          {pick.image ? (
            // biome-ignore lint/performance/noImgElement: album art is a remote Qobuz CDN url
            <img
              src={pick.image}
              alt=""
              loading="lazy"
              className="size-11 shrink-0 rounded-md bg-zinc-800 object-cover"
            />
          ) : (
            <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-zinc-800">
              <Disc3 className="size-5" aria-hidden="true" />
            </span>
          )}
          <span className="min-w-0 flex-1 text-sm">
            <span className={`block line-clamp-2 ${tone === "on" ? "" : "text-zinc-200"}`}>{pick.title}</span>
            <span className="mt-0.5 block truncate text-xs text-zinc-400">{pick.artists.join(", ")}</span>
            <span
              className={`mt-1 block text-[11px] ${error ? "text-amber-300" : tone === "on" ? "text-lamp" : "text-zinc-500"}`}
            >
              {marker}
            </span>
          </span>
          <span className="font-mono text-xs tabular-nums opacity-50">{clock(pick.durationMs)}</span>
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={`${open ? "Hide" : "Show"} details for ${pick.title}`}
          aria-expanded={open}
          className={`flex size-11 shrink-0 items-center justify-center rounded-full text-zinc-500 transition hover:text-zinc-200 ${focusRing}`}
        >
          <ChevronDown className={`size-4 transition ${open ? "rotate-180" : ""}`} strokeWidth={1.75} />
        </button>
      </div>
      {error && (
        <div
          role="alert"
          className="mb-3 ml-4 rounded-lg border border-amber-900/60 px-3 py-2 text-xs text-amber-200"
        >
          <p>{error}</p>
          <button type="button" onClick={onRetry} className={`min-h-11 underline ${focusRing}`}>
            Retry download
          </button>
        </div>
      )}
      {open && (
        <>
          <Detail cue={cue} />
          {onRetake && (
            <button
              type="button"
              onClick={onRetake}
              disabled={retaking}
              aria-label={retaking ? "Voicing again" : "Voice this slot again"}
              title={retaking ? "Voicing again…" : "Voice again, with the settings as they are now"}
              className={`mb-3 ml-4 flex min-h-11 items-center gap-2 rounded-lg px-3 text-xs transition ${retaking ? "text-lamp" : "text-zinc-400 hover:text-zinc-200"} ${focusRing}`}
            >
              <RefreshCw
                className={`size-3.5 ${retaking ? "animate-[spin_1.6s_linear_infinite]" : ""}`}
                strokeWidth={1.75}
                aria-hidden="true"
              />
              {retaking ? "Recording another take…" : "Record another DJ take"}
            </button>
          )}
        </>
      )}
    </li>
  );
}

/** The words as written, the writer's numbers, the chart, the treatment, the fallback and its reason. Nothing editable. */
function Detail({ cue }: { cue: Cue }) {
  const numbers: [string, number | undefined][] = [
    ["record under", cue.recordUnderMs],
    ["voice in", cue.voiceInMs],
  ];
  const chart = cue.chart;
  return (
    <div className="mb-2 ml-4 flex flex-col gap-2 rounded-lg border border-zinc-800/70 bg-zinc-950/60 px-3 py-2.5 text-xs text-zinc-400">
      <Label>{KIND_LABEL[cue.kind]} · Studio notes</Label>
      {cue.legalId && <p className="font-mono text-[12px] italic text-zinc-500">{cue.legalId}</p>}
      {cue.words && (
        <p className="whitespace-pre-line font-mono text-[12px] leading-relaxed text-zinc-300">{cue.words}</p>
      )}
      {cue.leadLine && (
        <p className="whitespace-pre-line font-mono text-[12px] italic leading-relaxed text-zinc-300">
          {cue.leadLine}
        </p>
      )}
      {cue.kind === "segue" && !cue.words && <p className="text-zinc-500">straight in</p>}
      <p className="flex flex-wrap gap-x-4 gap-y-1 font-mono tabular-nums">
        {numbers.map(
          ([k, v]) =>
            v !== undefined && (
              <span key={k}>
                {k} {secs(v)}
              </span>
            ),
        )}
        <span>{cue.voiced ? (cue.clipKey ? takeOf(cue.clipKey) : "no clip") : "not voiced yet"}</span>
        <span>{cue.held ? "held" : "not held"}</span>
      </p>
      {chart ? (
        <p className="flex flex-wrap gap-x-4 gap-y-1 font-mono tabular-nums text-zinc-500">
          <span>
            ramp {secs(chart.rampMs)} ({chart.sure ? "sure" : "unsure"})
          </span>
          {chart.post && <span>post: {chart.post}</span>}
          <span>
            ends: {chart.outro} at {clock(chart.outroMs)}
          </span>
          <span>
            energy {chart.energy}/5 · {chart.tempo} · {chart.mood}
          </span>
        </p>
      ) : (
        <p className="text-zinc-500">no chart</p>
      )}
      {cue.treatment && <p className="text-zinc-500">{cue.treatment}</p>}
      {cue.news && (
        <div className="mt-2 border-t border-zinc-800 pt-3">
          <p className="font-medium text-zinc-300">{cue.news.words ? "News sources" : "News omitted"}</p>
          <p className="mt-1">{cue.news.reason}</p>
          <p className="mt-1 text-zinc-500">Checked {new Date(cue.news.checkedAt).toLocaleString()}</p>
          {cue.news.sources.map((source) => (
            <p key={source.url} className="mt-2">
              <a href={source.url} target="_blank" rel="noreferrer" className="text-lamp underline">
                {source.source}: {source.title}
              </a>
              <span className="block text-zinc-500">Published {new Date(source.at).toLocaleString()}</span>
            </p>
          ))}
          {(cue.news.previous ?? []).map((take) => (
            <details key={take.clipKey} className="mt-2">
              <summary className="cursor-pointer">
                Earlier recording · {new Date(take.at).toLocaleString()}
              </summary>
              <p className="mt-1">{take.words}</p>
            </details>
          ))}
        </div>
      )}
      <p className="text-zinc-600">{cue.why}</p>
      {cue.fallback && (
        <p className="text-amber-300/90">
          {cue.fallback.from} → {cue.fallback.to}: {cue.fallback.reason}
        </p>
      )}
    </div>
  );
}

/** The first take's key is `<seq>.mp3`; a later take's carries a marker after the seq. */
const takeOf = (clipKey: string) => (/-[^/]+\.mp3$/.test(clipKey) ? "voiced again" : "voiced");

/** A slot not written yet: what the proposer named, in the dim tone. */
function ToCome({ slot, label }: { slot: Slot; label: string }) {
  return (
    <li className="rail-row flex items-center gap-3 py-4 pr-2 pl-4 text-zinc-500">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-md border border-dashed border-zinc-800 font-mono text-xs">
        {String(slot.seq).padStart(2, "0")}
      </span>
      <span className="min-w-0 flex-1 text-sm">
        <span className="block line-clamp-2 text-zinc-300">{slot.title}</span>
        <span className="mt-0.5 block truncate text-xs text-zinc-400">{slot.artist}</span>
        <span className="mt-1 block text-[11px]">{label === "coming up" ? "Coming up" : "Preparing…"}</span>
      </span>
    </li>
  );
}
