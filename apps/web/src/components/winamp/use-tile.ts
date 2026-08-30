import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { ASSETS, type Sheet } from "./skin";

/**
 * A repeating tile cut from a sheet. `background-repeat` repeats the whole image, so a strip
 * that must tile (the playlist's edges) is first cropped onto a canvas and used as its own
 * image — the way Webamp does every sprite. Cached per cut for the page's life.
 */
const tiles = new Map<string, Promise<string>>();

function crop(sheet: Sheet, x: number, y: number, w: number, h: number): Promise<string> {
  const key = `${sheet}:${x}:${y}:${w}:${h}`;
  let p = tiles.get(key);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        c.getContext("2d")?.drawImage(img, x, y, w, h, 0, 0, w, h);
        resolve(c.toDataURL());
      };
      img.onerror = () => reject(new Error(`${sheet}.bmp did not load`));
      img.src = `${ASSETS}/${sheet}.bmp`;
    });
    tiles.set(key, p);
  }
  return p;
}

export function useTile(
  sheet: Sheet,
  x: number,
  y: number,
  w: number,
  h: number,
  repeat: "repeat-x" | "repeat-y",
): CSSProperties {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    crop(sheet, x, y, w, h).then(
      (u) => live && setUrl(u),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [sheet, x, y, w, h]);
  return url ? { backgroundImage: `url(${url})`, backgroundRepeat: repeat } : {};
}
