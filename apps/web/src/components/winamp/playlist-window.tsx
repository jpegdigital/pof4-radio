import type { ReactNode } from "react";
import type { Cursor, SegmentView } from "../station/reducer";
import { PLAYLIST as P } from "./skin";
import { useTile } from "./use-tile";

/**
 * The playlist window: the show as Winamp would list it — one numbered line per item, the
 * DJ's talk a line like any track, the duration on the right — inside the skin's frame. It
 * fills whatever height the page leaves below the main window and scrolls inside. `header`
 * (the request console) sits at the top of the list, in the list's own colours.
 */
export function PlaylistWindow({
  segments,
  cursor,
  dj,
  header,
  onJump,
}: {
  segments: SegmentView[];
  cursor: Cursor | null;
  dj: string;
  header: ReactNode;
  onJump: (seg: number, item: number) => void;
}) {
  const rows: { seg: number; item: number; text: string; time: string; tone: Tone }[] = [];
  let n = 0;
  for (const [seg, s] of segments.entries()) {
    n++;
    rows.push({
      seg,
      item: 0,
      text: `${n}. ${dj} - ${firstSentence(s.talk)}`,
      time: "",
      tone: tone(cursor, seg, 0),
    });
    for (const [i, t] of s.tracks.entries()) {
      n++;
      rows.push({
        seg,
        item: i + 1,
        text: `${n}. ${t.artists.join(", ")} - ${t.name}`,
        time: clock(t.durationMs),
        tone: tone(cursor, seg, i + 1),
      });
    }
  }

  const topTile = useTile("pledit", 127, 0, 25, 20, "repeat-x");
  const leftTile = useTile("pledit", 0, 42, 12, 29, "repeat-y");
  const rightTile = useTile("pledit", 31, 42, 20, 29, "repeat-y");

  return (
    <div className="wa-pl">
      <div className="wa-pl-top">
        <span style={P.topLeft} />
        <span className="wa-pl-fill" style={topTile} />
        <span style={P.title} />
        <span className="wa-pl-fill" style={topTile} />
        <span style={P.topRight} />
      </div>
      <div className="wa-pl-mid">
        <span className="wa-pl-left" style={leftTile} />
        <div className="wa-pl-body">
          {header}
          <ol className="wa-pl-list">
            {rows.map((r) => (
              <li key={`${r.seg}:${r.item}`}>
                <button
                  type="button"
                  className={`wa-pl-row wa-${r.tone}`}
                  aria-current={r.tone === "on" ? "true" : undefined}
                  onClick={() => onJump(r.seg, r.item)}
                >
                  <span className="wa-pl-text">{r.text}</span>
                  <span className="wa-pl-time">{r.time}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
        <span className="wa-pl-right" style={rightTile} />
      </div>
      <div className="wa-pl-bottom">
        <span style={P.bottomLeft} />
        <span style={P.bottomRight} />
      </div>
    </div>
  );
}

type Tone = "played" | "on" | "ahead";

function tone(cursor: Cursor | null, seg: number, item: number): Tone {
  if (cursor === null) return "ahead";
  if (seg === cursor.seg && item === cursor.item) return "on";
  return seg < cursor.seg || (seg === cursor.seg && item < cursor.item) ? "played" : "ahead";
}

function clock(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function firstSentence(text: string): string {
  const m = text.match(/^.*?[.!?…](\s|$)/);
  return (m ? m[0] : text).trim();
}
