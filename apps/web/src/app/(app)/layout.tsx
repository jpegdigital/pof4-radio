import type { ReactNode } from "react";

/** The new home shell. Deliberately bare — it grows only as the new app needs it. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-dvh">{children}</div>;
}
