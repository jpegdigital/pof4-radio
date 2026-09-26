import type { Metadata, Viewport } from "next";
import { Press_Start_2P, VT323 } from "next/font/google";
import type { ReactNode } from "react";
import "./booth.css";

// The booth's two faces: an arcade marquee for labels, a terminal for what is read.
const arcade = Press_Start_2P({ variable: "--font-arcade", subsets: ["latin"], weight: "400" });
const terminal = VT323({ variable: "--font-terminal", subsets: ["latin"], weight: "400" });

export const metadata: Metadata = { title: "The Booth · Claude Radio" };
export const viewport: Viewport = { themeColor: "#0a0120" };

/** The booth is full screen: no phone frame, no desk — the scene is the page. */
export default function BoothLayout({ children }: { children: ReactNode }) {
  return <div className={`${arcade.variable} ${terminal.variable}`}>{children}</div>;
}
