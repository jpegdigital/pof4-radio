import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The program shell: the studio wall. Wide, its own signage — nothing shared with the station's
 * phone column, so the format can be developed in one sandbox.
 */
export default function ProgramLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-6 px-5 py-6 sm:px-8">
      <header className="flex items-baseline justify-between border-b border-zinc-800 pb-4">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-2xl font-semibold uppercase tracking-[0.18em]">WFAI 56.6</span>
          <span className="font-display text-sm uppercase tracking-[0.2em] text-zinc-500">
            Claude Radio · the program
          </span>
        </div>
        <nav className="flex items-baseline gap-5">
          <Link
            href="/program/make"
            className="font-display text-sm uppercase tracking-[0.2em] text-zinc-500 transition hover:text-zinc-300"
          >
            the maker
          </Link>
          <Link
            href="/"
            className="font-display text-sm uppercase tracking-[0.2em] text-zinc-500 transition hover:text-zinc-300"
          >
            ← the station
          </Link>
        </nav>
      </header>
      <main className="flex flex-1 flex-col gap-6">{children}</main>
    </div>
  );
}
