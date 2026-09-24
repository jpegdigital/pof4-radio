import type { PreparedSlot } from "./mix";

export type EngineEvent =
  | { type: "position" | "interrupted"; positionMs: number }
  | { type: "ended" | "voice-ended" | "recovered" }
  | { type: "failed"; error: Error };

/** One owner; one cancellable placement of the entire mix. No browser types in the contract. */
export interface AudioEngine {
  unlock(): void;
  set(
    slot: PreparedSlot,
    positionMs: number,
    playing: boolean,
    signal: AbortSignal,
    emit: (event: EngineEvent) => void,
  ): Promise<void>;
  readPosition(): number;
  stop(): number;
  dispose(): void;
}
