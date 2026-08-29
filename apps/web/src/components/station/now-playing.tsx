import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useEffect, useState } from "react";
import { focusRing } from "./ui";
import type { Playback } from "./use-spotify-device";

/**
 * The transport: art, title, a progress line and three controls. Position is interpolated
 * from the SDK's last state while playing; the SDK only reports on change.
 */
export function NowPlaying({
  playback,
  onPrev,
  onNext,
  onToggle,
}: {
  playback: Playback;
  onPrev: () => void;
  onNext: () => void;
  onToggle: () => void;
}) {
  const t = playback.track;
  const position = useLivePosition(playback);
  const pct = playback.duration > 0 ? Math.min(100, (position / playback.duration) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        {t?.image ? (
          // biome-ignore lint/performance/noImgElement: album art is a remote Spotify CDN url
          <img src={t.image} alt="" className="size-20 shrink-0 rounded-lg bg-zinc-800 object-cover" />
        ) : (
          <div className="size-20 shrink-0 rounded-lg bg-zinc-800" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-medium">{t?.name ?? "—"}</div>
          <div className="truncate text-sm text-zinc-400">{t?.artists.join(", ")}</div>
          <div className="truncate text-xs text-zinc-500">{t?.album}</div>
        </div>
      </div>

      <div>
        <div className="h-1 overflow-hidden rounded-full bg-zinc-800">
          <div className="h-full bg-zinc-200" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1 flex justify-between font-mono text-[11px] tabular-nums text-zinc-500">
          <span>{clock(position)}</span>
          <span>{clock(playback.duration)}</span>
        </div>
      </div>

      <div className="flex items-center justify-center gap-6">
        <button type="button" onClick={onPrev} aria-label="Previous track" className={iconBtn}>
          <SkipBack className="size-6" fill="currentColor" strokeWidth={0} />
        </button>
        <button
          type="button"
          onClick={onToggle}
          aria-label={playback.paused ? "Play" : "Pause"}
          className={`flex size-14 items-center justify-center rounded-full bg-zinc-100 text-black transition hover:scale-105 active:scale-95 ${focusRing}`}
        >
          {playback.paused ? (
            <Play className="ml-0.5 size-6" fill="currentColor" strokeWidth={0} />
          ) : (
            <Pause className="size-6" fill="currentColor" strokeWidth={0} />
          )}
        </button>
        <button type="button" onClick={onNext} aria-label="Next track" className={iconBtn}>
          <SkipForward className="size-6" fill="currentColor" strokeWidth={0} />
        </button>
      </div>
    </div>
  );
}

const iconBtn = `rounded-full p-2 text-zinc-300 transition hover:text-white active:scale-95 ${focusRing}`;

function useLivePosition(p: Playback): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (p.paused) return;
    const id = setInterval(() => setNow(performance.now()), 500);
    return () => clearInterval(id);
  }, [p.paused, p.at]);
  return p.paused ? p.position : Math.min(p.duration, p.position + (now - p.at));
}

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
