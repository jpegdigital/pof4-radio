import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The control room shell: wide, for a desk. Same ground as the station, but the signage
 * face comes out — this side of the glass is labelled like equipment.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-8 px-5 py-6 sm:px-8 sm:py-8">
      <header className="flex items-baseline justify-between border-b border-zinc-800 pb-4">
        <Link href="/" className="group flex items-baseline gap-3">
          <span className="text-xl font-semibold tracking-tight">Radio</span>
          <span className="font-display text-sm uppercase tracking-[0.2em] text-zinc-500 transition group-hover:text-zinc-300">
            ← Back to the station
          </span>
        </Link>
        <span className="font-display text-sm uppercase tracking-[0.2em] text-zinc-500">Control room</span>
      </header>
      <main className="flex flex-1 flex-col gap-8">{children}</main>
    </div>
  );
}
