import { ChevronDown, History } from "lucide-react";
import { useEffect, useState } from "react";
import { guarded } from "@/lib/guard-client";
import { focusRing } from "./ui";

/**
 * Pick up a past show. Shown only on a fresh page, before anything is on air: choosing a
 * station loads its prompt and history; pressing Run then continues that DJ conversation
 * (the next talk bridges from wherever it left off).
 */

export interface StationSummary {
  stationId: string;
  prompt: string;
  segmentCount: number;
  updatedAt: string;
}

export function ResumePicker({ onPick }: { onPick: (id: string) => void }) {
  const [stations, setStations] = useState<StationSummary[] | null>(null);
  useEffect(() => {
    let live = true;
    void guarded("/api/stations", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<StationSummary[]>) : []))
      .then((list) => {
        if (live) setStations(list);
      })
      .catch(() => {
        if (live) setStations([]);
      });
    return () => {
      live = false;
    };
  }, []);

  if (!stations?.length) return null;
  return (
    <label className="relative flex min-w-0 items-center gap-2 text-xs text-zinc-500">
      <History className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      <span className="sr-only">Resume a show</span>
      <select
        defaultValue=""
        onChange={(e) => e.target.value && onPick(e.target.value)}
        className={`min-w-0 flex-1 appearance-none truncate rounded-md bg-transparent py-1 pr-5 hover:text-zinc-300 ${focusRing}`}
      >
        <option value="">Resume a show…</option>
        {stations.map((s) => (
          <option key={s.stationId} value={s.stationId}>
            {when(s.updatedAt)} · {s.segmentCount} block{s.segmentCount === 1 ? "" : "s"} · {s.prompt}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-0 size-3.5"
        strokeWidth={1.75}
        aria-hidden="true"
      />
    </label>
  );
}

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
