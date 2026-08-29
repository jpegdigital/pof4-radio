import { ChevronDown, Mic } from "lucide-react";
import { focusRing } from "./ui";
import { DEFAULT_DJ, DJS, type Dj, findDj } from "./voice-store";

const GROUPS = [
  { gender: "female", label: "Female" },
  { gender: "male", label: "Male" },
] as const;

/** Who's on the mic. The default sits alone at the top; the rest are grouped by gender. */
export function DjPicker({ value, onChange }: { value: Dj; onChange: (d: Dj) => void }) {
  return (
    <label className="relative flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950 pr-2 pl-3 text-sm">
      <Mic className="size-4 shrink-0 text-zinc-500" strokeWidth={1.75} aria-hidden="true" />
      <span className="sr-only">DJ</span>
      <select
        value={value.id}
        onChange={(e) => onChange(findDj(e.target.value))}
        className={`appearance-none bg-transparent py-1.5 pr-5 text-zinc-100 ${focusRing} rounded-full`}
      >
        <option value={DEFAULT_DJ.id}>{DEFAULT_DJ.name}</option>
        {GROUPS.map((g) => (
          <optgroup key={g.gender} label={g.label}>
            {DJS.filter((d) => d.gender === g.gender && d.id !== DEFAULT_DJ.id).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2 size-4 text-zinc-500"
        strokeWidth={1.75}
        aria-hidden="true"
      />
    </label>
  );
}
