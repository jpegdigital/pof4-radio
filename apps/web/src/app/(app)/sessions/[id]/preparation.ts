import type { Slot } from "./types";

export interface Preparation {
  label: string;
  busy: boolean;
  ready: boolean;
}

/** Shared by the player and rundown: a written intro is not yet a playable show. */
export function preparation(
  slot: Slot | undefined,
  { opening = false, failed = false, downloadFailed = false, observing = false } = {},
): Preparation {
  if (slot?.voiced && slot.held) return { label: "Ready to play", busy: false, ready: true };
  if (failed) return { label: "Preparation needs another try", busy: false, ready: false };
  if (downloadFailed) return { label: "Download needs another try", busy: false, ready: false };
  if (opening) return { label: "Opening your show…", busy: true, ready: false };
  if (observing) return { label: "Your show is being prepared in another tab…", busy: true, ready: false };
  if (!slot) return { label: "Choosing your tracks…", busy: true, ready: false };
  if (!slot.voiced)
    return {
      label: slot.seq === 1 ? "Preparing your opening…" : "Preparing the DJ’s introduction…",
      busy: true,
      ready: false,
    };
  return { label: "Getting your track ready…", busy: true, ready: false };
}

/** A fresh snapshot proves whether a request with an uncertain outcome finished. */
export function moveCompleted(key: string, slots: readonly Pick<Slot, "seq" | "status">[]): boolean {
  const [kind, value] = key.split(":");
  return kind === "fill"
    ? slots.length > Number(value)
    : slots.some((slot) => slot.seq === Number(value) && slot.status === "voiced");
}
