import type { ReactNode } from "react";

/** The station shell: one phone-wide column. The masthead is the station's (it carries the on-air lamp). */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-4 pt-5 pb-10">
      <main className="flex flex-1 flex-col gap-4">{children}</main>
    </div>
  );
}
