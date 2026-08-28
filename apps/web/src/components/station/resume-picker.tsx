import { useEffect, useState } from "react";
import { guarded } from "@/lib/guard-client";

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
    <label className="flex items-center gap-2 text-sm text-zinc-400">
      <span>Resume a show</span>
      <select
        defaultValue=""
        onChange={(e) => e.target.value && onPick(e.target.value)}
        className="max-w-md flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-200"
      >
        <option value="">— pick a past station —</option>
        {stations.map((s) => (
          <option key={s.stationId} value={s.stationId}>
            {when(s.updatedAt)} · {s.segmentCount} block{s.segmentCount === 1 ? "" : "s"} · {s.prompt}
          </option>
        ))}
      </select>
    </label>
  );
}

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
