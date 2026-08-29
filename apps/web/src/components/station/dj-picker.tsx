import { ChevronDown } from "lucide-react";
import { focusRing } from "./ui";
import { DEFAULT_DJ, DJS, type Dj, findDj } from "./voice-store";

const GROUPS = [
  { gender: "female", label: "Female" },
  { gender: "male", label: "Male" },
] as const;

/**
 * Who's on the mic, as a trailing value control: the name and a chevron, no chrome of its own —
 * the row it sits in is the chrome. The default sits alone at the top; the rest are grouped.
 */
export function DjPicker({ value, onChange }: { value: Dj; onChange: (d: Dj) => void }) {
  return (
    <label className="relative flex items-center text-sm">
      <span className="sr-only">DJ</span>
      <select
        value={value.id}
        onChange={(e) => onChange(findDj(e.target.value))}
        className={`appearance-none rounded-full bg-transparent py-1.5 pr-6 pl-2 text-zinc-100 transition hover:text-white ${focusRing}`}
      >
        <option value={DEFAULT_DJ.id} className="bg-zinc-950">
          {DEFAULT_DJ.name}
        </option>
        {GROUPS.map((g) => (
          <optgroup key={g.gender} label={g.label} className="bg-zinc-950">
            {DJS.filter((d) => d.gender === g.gender && d.id !== DEFAULT_DJ.id).map((d) => (
              <option key={d.id} value={d.id} className="bg-zinc-950">
                {d.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-1 size-4 text-zinc-500"
        strokeWidth={1.75}
        aria-hidden="true"
      />
    </label>
  );
}
