import { Mic } from "lucide-react";
import type { Cursor, SegmentView } from "./reducer";
import { focusRing, Label } from "./ui";

/**
 * The cue sheet: the whole show, every block a metatrack — its talk, then its tracks — each row
 * a place you can jump to. The rail down the left is amber to the row on air and dark past it:
 * where tonight is, at a glance.
 */
export function Show({
  segments,
  cursor,
  voiced,
  onJump,
}: {
  segments: SegmentView[];
  cursor: Cursor | null;
  /** Whether a block's talk audio is already fetched (an "up next" block that isn't shows quietly). */
  voiced: (segmentId: string) => boolean;
  onJump: (seg: number, item: number) => void;
}) {
  if (segments.length === 0) return null;
  const lit = (seg: number, item: number) =>
    cursor !== null && (seg < cursor.seg || (seg === cursor.seg && item <= cursor.item));
  const on = (seg: number, item: number) => cursor?.seg === seg && cursor.item === item;

  return (
    <div className="flex flex-col gap-3">
      <Label>The show</Label>
      <ol className="flex flex-col">
        {segments.map((s, seg) => {
          const upNext = cursor !== null && seg === cursor.seg + 1;
          return (
            <li key={s.id} className="flex flex-col">
              <div className="rail-row pl-4 pt-3 pb-1">
                <div className="flex items-baseline justify-between gap-2 text-xs text-zinc-500">
                  <span className="truncate">
                    Block {s.seq} · “{s.prompt}”
                  </span>
                  {upNext && (
                    <span className="shrink-0 font-display uppercase tracking-[0.18em] text-zinc-600">
                      {voiced(s.id) ? "up next" : "up next · voicing"}
                    </span>
                  )}
                </div>
              </div>
              <Row lit={lit(seg, 0)} on={on(seg, 0)} onClick={() => onJump(seg, 0)}>
                <Mic className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                <span className="line-clamp-2 min-w-0 flex-1 font-mono text-sm leading-relaxed">
                  {s.talk}
                </span>
              </Row>
              {s.tracks.map((t, i) => (
                <Row key={t.id} lit={lit(seg, i + 1)} on={on(seg, i + 1)} onClick={() => onJump(seg, i + 1)}>
                  <span className="w-4 shrink-0 font-mono text-xs text-zinc-600">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {t.artists.join(", ")} — {t.name}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-zinc-600">{clock(t.durationMs)}</span>
                </Row>
              ))}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Row({
  lit,
  on,
  onClick,
  children,
}: {
  lit: boolean;
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`rail-row ${lit ? "lit" : ""}`}>
      <button
        type="button"
        onClick={onClick}
        aria-current={on ? "true" : undefined}
        className={`flex w-full items-start gap-2 rounded-lg py-1.5 pr-2 pl-4 text-left transition hover:bg-zinc-800/50 ${
          on ? "text-lamp" : "text-zinc-400"
        } ${focusRing}`}
      >
        {children}
      </button>
    </div>
  );
}

function clock(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
