import { useEffect, useState } from "react";
import { CHAR, digit, DIGIT, glyph } from "./skin";

/** A run of the skin's 5×6 bitmap font. */
export function BitmapText({ text, left, top }: { text: string; left: number; top: number }) {
  return (
    <div className="wa-abs wa-row-flex" style={{ left, top, height: CHAR.height }} aria-hidden="true">
      {[...text].map((ch, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: glyphs are positional
        <span key={i} className="wa-glyph" style={glyph(ch)} />
      ))}
    </div>
  );
}

/**
 * The marquee: the text fits in `chars` cells or, Winamp-style, is padded with ` *** ` and
 * scrolled one cell every 220 ms. Restarts from the left whenever the text changes.
 */
export function Marquee({
  text,
  chars,
  left,
  top,
}: {
  text: string;
  chars: number;
  left: number;
  top: number;
}) {
  const [offset, setOffset] = useState(0);
  const scrolls = text.length > chars;
  const loop = scrolls ? `${text}  ***  ` : text;
  // a new text starts from the left (the "previous prop" pattern: adjust state during render)
  const [shownLoop, setShownLoop] = useState(loop);
  if (shownLoop !== loop) {
    setShownLoop(loop);
    setOffset(0);
  }
  useEffect(() => {
    if (!scrolls) return;
    const id = setInterval(() => setOffset((o) => (o + 1) % loop.length), 220);
    return () => clearInterval(id);
  }, [loop, scrolls]);
  const shown = scrolls ? (loop + loop).slice(offset, offset + chars) : text.padEnd(chars);
  return <BitmapText text={shown} left={left} top={top} />;
}

/** `mm:ss` in the skin's 9×13 digits at the four given x positions (a blank digit is a hole). */
export function Clock({
  ms,
  xs,
  top,
  blank,
}: {
  ms: number;
  xs: readonly number[];
  top: number;
  blank?: boolean;
}) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.min(99, Math.floor(s / 60));
  const digits = [Math.floor(m / 10), m % 10, Math.floor((s % 60) / 10), (s % 60) % 10];
  if (blank) return null;
  return (
    <>
      {digits.map((d, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional
        <span key={i} className="wa-abs" style={{ ...digit(d), left: xs[i], top, height: DIGIT.height }} />
      ))}
    </>
  );
}
