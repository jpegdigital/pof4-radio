import { Settings } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

/** The station shell: one phone-wide column, masthead on top. The listener's side of the glass. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-4 pt-5 pb-10">
      <header className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold uppercase tracking-[0.18em]">Claude Radio</h1>
        <Link
          href="/settings"
          aria-label="Settings"
          className="-mr-2 rounded-full p-2 text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lamp"
        >
          <Settings className="size-5" strokeWidth={1.75} />
        </Link>
      </header>
      <main className="flex flex-1 flex-col gap-4">{children}</main>
    </div>
  );
}
