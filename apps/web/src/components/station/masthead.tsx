import { Settings } from "lucide-react";
import Link from "next/link";

/**
 * The nav bar: the station's name, and — trailing, where a status indicator belongs — the on-air
 * lamp. Dark glass off air; lit amber while the loop runs; breathing while the DJ talks. The page's
 * one accent, always in view.
 */
export function Masthead({ running, talking }: { running: boolean; talking: boolean }) {
  return (
    <header className="flex items-center justify-between gap-3">
      <h1 className="font-display text-2xl font-semibold uppercase tracking-[0.18em]">Claude Radio</h1>
      <div className="flex items-center gap-1">
        <div
          role="status"
          aria-live="polite"
          className={`flex h-8 items-center gap-2 rounded-full border px-3 font-display text-xs font-semibold uppercase tracking-[0.2em] transition ${
            running ? "border-lamp/40 bg-lamp/10 text-lamp" : "border-zinc-800 text-zinc-500"
          }`}
        >
          <span
            aria-hidden="true"
            className={`lamp size-2 rounded-full ${running ? "on" : ""} ${talking ? "talking" : ""}`}
          />
          {running ? "On air" : "Off air"}
        </div>
        <Link
          href="/settings"
          aria-label="Settings"
          className="-mr-2 rounded-full p-2 text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lamp"
        >
          <Settings className="size-5" strokeWidth={1.75} />
        </Link>
      </div>
    </header>
  );
}
