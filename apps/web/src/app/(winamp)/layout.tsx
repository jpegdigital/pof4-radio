import type { Viewport } from "next";
import type { ReactNode } from "react";
import "./winamp.css";

/**
 * The Winamp shell: black to the edges, no masthead — the skin is the whole page. Pinch-zoom
 * is off so iOS doesn't zoom the page into a focused input (the view zooms itself, use-zoom.ts).
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#000000",
};

export default function WinampLayout({ children }: { children: ReactNode }) {
  return <div className="wa-page">{children}</div>;
}
