import type { AudioEngine, EngineEvent } from "./engine";
import { clamp, type PreparedSlot, type SeekTarget, seekPosition, slotDuration } from "./mix";

type Intent = "play" | "pause";
interface Base {
  id: string;
  operationId: number;
  intent: Intent;
  positionMs: number;
}
type WithSlot = Base & { slot: PreparedSlot };
export type PlayerSnapshot =
  | (Base & { phase: "empty" })
  | (Base & { phase: "loading" })
  | (WithSlot & { phase: "seeking"; confirmedPositionMs: number })
  | (WithSlot & { phase: "ready"; status: "playing" | "paused" | "interrupted" })
  | (WithSlot & { phase: "ended" })
  | (Base & { phase: "failed"; slot?: PreparedSlot; error: string; retryPositionMs: number });

export const EMPTY: PlayerSnapshot = {
  phase: "empty",
  id: "",
  operationId: 0,
  intent: "pause",
  positionMs: 0,
};

/** Synchronous transport ownership. React and Media Session only observe snapshots. */
export class Player {
  private state: PlayerSnapshot = EMPTY;
  private listeners = new Set<() => void>();
  private operation = new AbortController();
  private sequence = 0;
  private disposed = false;
  constructor(
    private engine: AudioEngine,
    private voiceEnded: (slot: PreparedSlot) => void = () => {},
  ) {}

  getSnapshot = (): PlayerSnapshot => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(state: PlayerSnapshot) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  private replace() {
    this.operation.abort();
    this.engine.stop();
    this.operation = new AbortController();
    return ++this.sequence;
  }
  unlock = () => {
    if (!this.disposed) this.engine.unlock();
  };

  load(id: string, prepare: (signal: AbortSignal) => Promise<PreparedSlot>) {
    if (this.disposed) return;
    const operationId = this.replace();
    const { signal } = this.operation;
    this.publish({ phase: "loading", id, operationId, positionMs: 0, intent: "play" });
    void prepare(signal)
      .then((slot) => {
        if (signal.aborted) return;
        this.place(slot, 0, this.state.intent);
      })
      .catch((error: unknown) => {
        if (!signal.aborted) this.fail(error);
      });
  }

  seek(target: SeekTarget): number | null {
    const s = this.state;
    if (this.disposed || !("slot" in s) || !s.slot) return null;
    return this.place(s.slot, seekPosition(s.slot, target), s.intent);
  }
  play = () => {
    const s = this.state;
    if (this.disposed) return;
    if (s.intent === "play" && s.phase !== "failed" && !(s.phase === "ready" && s.status === "interrupted"))
      return;
    if (s.phase === "ended" || s.phase === "loading") this.publish({ ...s, intent: "play" });
    else if ("slot" in s && s.slot)
      this.place(s.slot, s.phase === "failed" ? s.retryPositionMs : s.positionMs, "play");
  };
  pause = () => {
    const s = this.state;
    if (this.disposed || s.intent === "pause") return;
    if (s.phase === "loading" || s.phase === "ended") {
      this.publish({ ...s, intent: "pause" });
    } else if ("slot" in s && s.slot) {
      const at = s.phase === "ready" && s.status === "playing" ? this.engine.readPosition() : s.positionMs;
      this.place(s.slot, at, "pause");
    }
  };

  private place(slot: PreparedSlot, at: number, intent: Intent): number {
    const previous = this.state;
    const confirmedPositionMs =
      previous.id !== slot.id
        ? 0
        : previous.phase === "seeking"
          ? previous.confirmedPositionMs
          : previous.positionMs;
    const operationId = this.replace();
    const positionMs = clamp(at, slotDuration(slot));
    const base = { id: slot.id, slot, positionMs, intent, operationId };
    if (positionMs >= slotDuration(slot)) {
      this.publish({ ...base, phase: "ended" });
      return operationId;
    }
    const { signal } = this.operation;
    this.publish({ ...base, phase: "seeking", confirmedPositionMs });
    if (signal.aborted) return operationId;
    void this.engine
      .set(slot, positionMs, intent === "play", signal, (event) => {
        if (!signal.aborted) this.observe(event);
      })
      .then(() => {
        if (signal.aborted || this.state.phase !== "seeking") return;
        this.publish({ ...base, phase: "ready", status: intent === "play" ? "playing" : "paused" });
      })
      .catch((error: unknown) => {
        if (!signal.aborted) this.fail(error);
      });
    return operationId;
  }

  private observe(event: EngineEvent) {
    const s = this.state;
    if (!("slot" in s) || !s.slot || s.phase === "failed" || s.phase === "ended") return;
    if (event.type === "failed") {
      this.fail(event.error);
      return;
    }
    if (event.type === "voice-ended") {
      this.voiceEnded(s.slot);
      return;
    }
    if (event.type === "interrupted" && s.intent === "play") {
      this.publish({ ...s, phase: "ready", status: "interrupted", positionMs: event.positionMs });
    } else if (event.type === "recovered" && s.phase === "ready" && s.status === "interrupted") {
      this.place(s.slot, s.positionMs, s.intent);
    } else if (event.type === "position" && s.phase === "ready" && s.status === "playing") {
      this.publish({ ...s, positionMs: clamp(event.positionMs, slotDuration(s.slot)) });
    } else if (event.type === "ended" && s.phase === "ready" && s.status === "playing") {
      this.replace();
      this.publish({ ...s, phase: "ended", positionMs: slotDuration(s.slot) });
    }
  }
  private fail(error: unknown) {
    const s = this.state;
    this.replace();
    this.publish({
      ...s,
      phase: "failed",
      retryPositionMs: s.positionMs,
      positionMs: s.phase === "seeking" ? s.confirmedPositionMs : s.positionMs,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  dispose() {
    this.disposed = true;
    this.replace();
    this.engine.dispose();
    this.publish(EMPTY);
    this.listeners.clear();
  }
}
