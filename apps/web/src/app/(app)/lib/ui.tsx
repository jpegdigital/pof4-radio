import type { ReactNode } from "react";

/** The small shared vocabulary of the station page: a card and its signage label. */

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 ${className}`}>
      {children}
    </section>
  );
}

/** Signage: what's printed on the desk above each panel. */
export function Label({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <h2
      className={`font-display text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500 ${className}`}
    >
      {children}
    </h2>
  );
}

export const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lamp";
