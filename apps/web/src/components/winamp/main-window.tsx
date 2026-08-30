import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";
import { Clock, Marquee } from "./bitmap-text";
import { balanceFrame, MAIN, MAIN_WINDOW as W, sheetUrl, volumeFrame } from "./skin";

/**
 * The main window, 275×116: title bar, the time and the marquee, mono/stereo, the sliders, and
 * the five transport buttons plus eject — every piece a cut of the skin at Winamp's own
 * coordinates, laid over main.bmp. It shows what the station reports and forwards taps; it
 * decides nothing.
 */

export interface MainClock {
  paused: boolean;
  /** ms as of `at` (performance.now()); interpolated while playing. */
  position: number;
  duration: number;
  at: number;
}

export function MainWindow({
  marquee,
  clock,
  indicator,
  talk,
  volume,
  onPrev,
  onPlay,
  onPause,
  onStop,
  onNext,
  onEject,
}: {
  marquee: string;
  /** What the time and position bar show; null shows neither (stopped, or a voice still loading). */
  clock: MainClock | null;
  indicator: "playing" | "paused" | "stopped";
  /** The DJ is on: the mono lamp; a track lights stereo. */
  talk: boolean;
  volume: number;
  onPrev: () => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onNext: () => void;
  onEject: () => void;
}) {
  const position = useLivePosition(clock);
  const pct = clock && clock.duration > 0 ? Math.min(1, position / clock.duration) : 0;
  const thumbLeft = Math.round(pct * (W.position.width - 29));
  const volLeft = Math.round(Math.max(0, Math.min(1, volume)) * (W.volume.width - 14));

  return (
    <div
      className="wa-main"
      style={{ width: MAIN.width, height: MAIN.height, backgroundImage: sheetUrl("main") }}
    >
      <Piece at={W.titleBar} style={W.titleBar.cut} />
      <Piece at={W.clutterBar} style={W.clutterBar.cut} />
      <Piece at={W.indicator} style={W.indicator[indicator]} />

      {clock && (
        <div className={indicator === "paused" ? "wa-blink" : undefined}>
          <Clock ms={position} xs={W.time.digits} top={W.time.top} />
        </div>
      )}
      <Marquee text={marquee} chars={W.marquee.chars} left={W.marquee.left} top={W.marquee.top} />

      <Piece at={W.mono} style={talk ? W.mono.on : W.mono.off} />
      <Piece at={W.stereo} style={!talk && indicator !== "stopped" ? W.stereo.on : W.stereo.off} />

      <Piece at={W.volume} style={volumeFrame(volume)}>
        <span className="wa-abs" style={{ ...W.volume.thumb, left: volLeft, top: 1 }} />
      </Piece>
      <Piece at={W.balance} style={balanceFrame()}>
        <span className="wa-abs" style={{ ...W.balance.thumb, left: 12, top: 1 }} />
      </Piece>
      <Piece at={W.eqButton} style={W.eqButton.cut} />
      <Piece at={W.plButton} style={W.plButton.cut} />

      <Piece at={W.position} style={W.position.track}>
        {clock && <span className="wa-abs" style={{ ...W.position.thumb, left: thumbLeft, top: 0 }} />}
      </Piece>

      <Button at={W.buttons.prev} label="Previous" onClick={onPrev} />
      <Button at={W.buttons.play} label="Play" onClick={onPlay} />
      <Button at={W.buttons.pause} label="Pause" onClick={onPause} />
      <Button at={W.buttons.stop} label="Stop" onClick={onStop} />
      <Button at={W.buttons.next} label="Next" onClick={onNext} />
      <Button at={W.buttons.eject} label="Open the request" onClick={onEject} />
      <Piece at={W.shuffle} style={W.shuffle.cut} />
      <Piece at={W.repeat} style={W.repeat.cut} />
    </div>
  );
}

function Piece({
  at,
  style,
  children,
}: {
  at: { left: number; top: number };
  style: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <div
      className="wa-abs"
      style={{ ...style, left: at.left, top: at.top }}
      aria-hidden={children ? undefined : true}
    >
      {children}
    </div>
  );
}

/** A skin button: the "up" cut, swapped for the "down" cut while pressed (winamp.css). */
function Button({
  at,
  label,
  onClick,
}: {
  at: { left: number; top: number; up: CSSProperties; down: CSSProperties };
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="wa-btn"
      style={{ left: at.left, top: at.top, width: at.up.width, height: at.up.height }}
      aria-label={label}
      onClick={onClick}
    >
      <span className="wa-abs wa-up" style={at.up} />
      <span className="wa-abs wa-down" style={at.down} />
    </button>
  );
}

function useLivePosition(c: MainClock | null): number {
  const live = c !== null && !c.paused;
  const at = c?.at ?? 0;
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(performance.now()), 500);
    return () => clearInterval(id);
  }, [live, at]);
  if (!c) return 0;
  // `now` may predate a fresh report for up to a tick; never run the clock backwards for it
  return live ? Math.min(c.duration, c.position + Math.max(0, now - c.at)) : c.position;
}
