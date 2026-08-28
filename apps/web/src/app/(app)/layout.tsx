import Link from "next/link";
import type { ReactNode } from "react";

/** The station shell: one phone-wide column. The listener's side of the glass. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 px-5 py-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Radio</h1>
        <Link
          href="/settings"
          className="text-xs text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
        >
          Settings
        </Link>
      </header>
      <main className="flex flex-1 flex-col gap-8">{children}</main>
    </div>
  );
}
