import { Mic } from "lucide-react";
import type { Cursor, SegmentView } from "./reducer";
import { focusRing, Label } from "./ui";

/**
 * The cue sheet: the whole show, every block a metatrack — its talk, then its tracks — each row
 * a place you can jump to. The rail down the left is amber to the row on air and dark past it:
 * where tonight is, at a glance. Rows already played step back; the row on air is the lamp; what's
 * still to come reads at full strength. The talk is printed whole — it's the DJ's words, not a teaser.
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
  const tone = (seg: number, item: number): Tone => {
    if (cursor === null) return "ahead";
    if (seg === cursor.seg && item === cursor.item) return "on";
    return seg < cursor.seg || (seg === cursor.seg && item < cursor.item) ? "played" : "ahead";
  };

  return (
    <div className="flex flex-col gap-3">
      <Label>The show</Label>
      <ol className="flex flex-col">
        {segments.map((s, seg) => {
          const upNext = cursor !== null && seg === cursor.seg + 1;
          const here = cursor?.seg === seg;
          // the request is printed where it changes — a new ask mid-show — not on every block
          const newAsk = seg === 0 || s.prompt !== segments[seg - 1]?.prompt;
          return (
            <li key={s.id} className={`flex flex-col ${seg > 0 ? "mt-3 border-t border-zinc-800/80" : ""}`}>
              <div className={`rail-row pt-4 pb-1.5 pl-4 ${here ? "lit" : ""}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <span
                    className={`shrink-0 font-display text-[11px] font-semibold uppercase tracking-[0.22em] ${
                      here ? "text-lamp" : "text-zinc-500"
                    }`}
                  >
                    Block {s.seq}
                  </span>
                  {upNext ? (
                    <span className="shrink-0 font-display text-[11px] uppercase tracking-[0.18em] text-zinc-600">
                      {voiced(s.id) ? "up next" : "up next · voicing"}
                    </span>
                  ) : (
                    newAsk && <span className="min-w-0 truncate text-xs text-zinc-600">“{s.prompt}”</span>
                  )}
                </div>
              </div>
              <Row tone={tone(seg, 0)} onClick={() => onJump(seg, 0)}>
                <Mic className="mt-1 size-3.5 shrink-0 opacity-70" strokeWidth={1.75} aria-hidden="true" />
                <span className="min-w-0 flex-1 font-mono text-[13px] leading-relaxed">{s.talk}</span>
              </Row>
              <div className="mt-1 flex flex-col">
                {s.tracks.map((t, i) => {
                  const tn = tone(seg, i + 1);
                  return (
                    <Row key={t.id} tone={tn} onClick={() => onJump(seg, i + 1)}>
                      <span className="w-4 shrink-0 font-mono text-xs tabular-nums opacity-50">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-sm">
                        <span className={tn === "on" ? "" : "text-zinc-200"}>{t.name}</span>
                        <span className={tn === "ahead" ? "text-zinc-500" : "opacity-70"}>
                          {" "}
                          · {t.artists.join(", ")}
                        </span>
                      </span>
                      <span className="font-mono text-xs tabular-nums opacity-50">{clock(t.durationMs)}</span>
                    </Row>
                  );
                })}
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

const TONE: Record<Tone, string> = {
  played: "text-zinc-500",
  on: "text-lamp",
  ahead: "text-zinc-400",
};

function Row({ tone, onClick, children }: { tone: Tone; onClick: () => void; children: React.ReactNode }) {
  return (
    <div className={`rail-row ${tone === "ahead" ? "" : "lit"}`}>
      <button
        type="button"
        onClick={onClick}
        aria-current={tone === "on" ? "true" : undefined}
        className={`flex w-full items-start gap-2.5 rounded-lg py-2 pr-2 pl-4 text-left transition hover:bg-zinc-800/50 ${TONE[tone]} ${focusRing}`}
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
