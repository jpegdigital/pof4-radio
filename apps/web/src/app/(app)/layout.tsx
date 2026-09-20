import type { ReactNode } from "react";

/** The listening app stays phone-sized, including on a desktop. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="radio-world">
      <div className="radio-phone">{children}</div>
    </div>
  );
}
