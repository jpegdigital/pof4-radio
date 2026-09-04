/**
 * The frontier, pure: the one call the page makes now, or none. A fill when there are no slots
 * or the unwritten ones are down to the low-water mark; else the first unvoiced slot, but only
 * one ahead of the cue in the deck — so before play only slot 1 is written, and once slot k is
 * on air slot k+1 is; the show never spends a model call on a slot nobody will reach. Each move
 * is keyed (`fill:<slot count>`, `slot:<seq>`) and made once per page life: a failure stays on
 * screen, a reload retries.
 */

export type Move = { kind: "fill"; key: string } | { kind: "slot"; seq: number; key: string } | null;

export function nextMove(
  slots: readonly { seq: number; status: "proposed" | "written" | "voiced" }[],
  clock: { lowWater: number },
  cueSeq: number | null,
  attempted: ReadonlySet<string>,
): Move {
  const pending = slots.filter((s) => s.status === "proposed").length;
  if (slots.length === 0 || pending <= clock.lowWater) {
    const key = `fill:${slots.length}`;
    if (!attempted.has(key)) return { kind: "fill", key };
  }
  const f = slots.find((s) => s.status !== "voiced");
  if (!f || f.seq > (cueSeq ?? 0) + 1) return null;
  const key = `slot:${f.seq}`;
  return attempted.has(key) ? null : { kind: "slot", seq: f.seq, key };
}
