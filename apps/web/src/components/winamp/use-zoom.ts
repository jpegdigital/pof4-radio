import { useLayoutEffect, useState } from "react";

/**
 * Fit a 275 px Winamp window to the phone. CSS `zoom` (not `transform`) so layout, hit
 * targets and scrolling all follow — the whole page is one zoomed column whose height is the
 * viewport's, in zoomed pixels. Capped at `max` so a desktop gets a big Winamp, not a wall.
 */
export function useZoom(width: number, max = 2): { zoom: number; height: number } | null {
  const [fit, setFit] = useState<{ zoom: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const zoom = Math.min(max, window.innerWidth / width);
      setFit({ zoom, height: Math.floor(window.innerHeight / zoom) });
    };
    measure();
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [width, max]);
  return fit;
}
