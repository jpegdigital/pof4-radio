import type { Element, Record as RecordShape } from "@radio/dj";
import type { ReactNode } from "react";
import { PLAYLIST as P } from "./skin";
import { useTile } from "./use-tile";

/**
 * The playlist window: the show as Winamp would list it — one numbered line per element, a
 * break a line like any song, the duration on the right — inside the skin's frame. A pending
 * segment's records follow in the dim tone. It fills whatever height the page leaves below the
 * main window and scrolls inside. `header` (the request console) sits at the top of the list,
 * in the list's own colours. `ahead` are the records whose slots haven't landed yet.
 */
export function PlaylistWindow({
  elements,
  ahead,
  cursor,
  dj,
  header,
  onJump,
}: {
  elements: Element[];
  ahead: RecordShape[];
  cursor: number | null;
  dj: string;
  header: ReactNode;
  onJump: (index: number) => void;
}) {
  const rows: { key: string; index: number | null; text: string; time: string; tone: Tone }[] = [];
  for (const [i, el] of elements.entries()) {
    rows.push({
      key: String(i),
      index: i,
      text:
        el.kind === "break"
          ? `${i + 1}. ${dj} - ${el.label.toLowerCase()}`
          : `${i + 1}. ${el.track.artists.join(", ")} - ${el.track.name}`,
      time: el.kind === "song" ? clock(el.track.durationMs) : "",
      tone: cursor === null ? "ahead" : i === cursor ? "on" : i < cursor ? "played" : "ahead",
    });
  }
  {
    for (const [i, r] of ahead.entries()) {
      rows.push({
        key: `ahead:${r.id}`,
        index: null,
        text: `${elements.length + i + 1}. ${r.artists.join(", ")} - ${r.name} (producing...)`,
        time: clock(r.durationMs),
        tone: "ahead",
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
              <li key={r.key}>
                <button
                  type="button"
                  className={`wa-pl-row wa-${r.tone}`}
                  aria-current={r.tone === "on" ? "true" : undefined}
                  disabled={r.index === null}
                  onClick={() => r.index !== null && onJump(r.index)}
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

function clock(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
