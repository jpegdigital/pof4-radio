import type { ReactNode } from "react";

/** A compact home desk and a listening surface that expands with the screen. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="radio-world">
      <div className="radio-phone">{children}</div>
    </div>
  );
}
