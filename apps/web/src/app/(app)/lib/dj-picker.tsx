import { ChevronDown } from "lucide-react";
import { focusRing } from "./ui";
import { type Dj, findDj } from "./voice-store";

const GROUPS = [
  { gender: "female", label: "Female" },
  { gender: "male", label: "Male" },
] as const;

/**
 * Who's on the mic: a filled field showing the name, chevron trailing — a pop-up button. The
 * roster's first sits alone at the top of the menu as the default; the rest are grouped.
 */
export function DjPicker({
  djs,
  value,
  onChange,
}: {
  djs: readonly Dj[];
  value: Dj;
  onChange: (d: Dj) => void;
}) {
  const first = djs[0];
  return (
    <label className="relative flex min-w-0 flex-1 items-center text-sm">
      <span className="sr-only">DJ</span>
      <PodcastMic className="pointer-events-none absolute left-3.5 size-5 text-zinc-500" />
      <select
        value={value.id}
        disabled={!first}
        onChange={(e) => onChange(findDj(djs, e.target.value))}
        className={`w-full appearance-none truncate rounded-xl border border-zinc-800 bg-zinc-950 py-2.5 pr-9 pl-11 text-base text-zinc-100 transition hover:border-zinc-700 ${focusRing}`}
      >
        {first ? (
          <option value={first.id} className="bg-zinc-950">
            {first.name}
          </option>
        ) : (
          <option value="" className="bg-zinc-950">
            {value.name}
          </option>
        )}
        {GROUPS.map((g) => (
          <optgroup key={g.gender} label={g.label} className="bg-zinc-950">
            {djs
              .filter((d) => d.gender === g.gender && d.id !== first?.id)
              .map((d) => (
                <option key={d.id} value={d.id} className="bg-zinc-950">
                  {d.name}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 size-4 text-zinc-500"
        strokeWidth={1.75}
        aria-hidden="true"
      />
    </label>
  );
}

/** A broadcast mic on its stand — the studio's own glyph, not the phone's dictation one. */
function PodcastMic({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="8" y="2.5" width="8" height="12" rx="4" />
      <path d="M8 7.5h8M8 10.5h8" strokeWidth={1.25} />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3.5M8.5 21.5h7" />
    </svg>
  );
}
