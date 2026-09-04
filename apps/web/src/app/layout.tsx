import type { Metadata } from "next";
import { Barlow_Condensed, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// Signage and script: the condensed face labels the desk, the mono face is what the DJ reads.
const barlow = Barlow_Condensed({ variable: "--font-barlow", subsets: ["latin"], weight: ["500", "600"] });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Claude Radio",
  description: "An AI DJ over your records.",
};

/**
 * The root: fonts, ground colour, nothing else. Each route group brings its own shell —
 * `(app)` is the station, phone-sized; `(settings)` is the control room, desktop-wide.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${barlow.variable} ${plexMono.variable} bg-zinc-950 text-zinc-100 antialiased`}
    >
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
