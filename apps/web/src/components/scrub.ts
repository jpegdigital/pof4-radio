export interface ScrubSnapshot {
  cueId: string;
  positionMs: number;
  durationMs: number;
  operationId: number;
  seeking: boolean;
}
type Gesture =
  | { phase: "idle" }
  | { phase: "dragging"; cueId: string; pointerId: number; positionMs: number }
  | { phase: "pending"; cueId: string; operationId: number; positionMs: number };
const IDLE: Gesture = { phase: "idle" };

export function positionAt(clientX: number, left: number, width: number, durationMs: number): number | null {
  if (![clientX, left, width, durationMs].every(Number.isFinite) || width <= 0 || durationMs <= 0)
    return null;
  return Math.max(0, Math.min(1, (clientX - left) / width)) * durationMs;
}

/** Gesture ownership and pending preview, independent of React and the audio implementation. */
export class ScrubGesture {
  private state: Gesture = IDLE;
  private listeners = new Set<() => void>();
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(state: Gesture) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  shown(snapshot: ScrubSnapshot): number {
    const s = this.state;
    if (s.phase === "idle" || s.cueId !== snapshot.cueId) return snapshot.positionMs;
    if (s.phase === "dragging") return s.positionMs;
    return snapshot.operationId < s.operationId ||
      (snapshot.operationId === s.operationId && snapshot.seeking)
      ? s.positionMs
      : snapshot.positionMs;
  }
  begin(cueId: string, pointerId: number, positionMs: number): boolean {
    if (this.state.phase === "dragging" && this.state.cueId === cueId) return false;
    this.publish({ phase: "dragging", cueId, pointerId, positionMs });
    return true;
  }
  move(cueId: string, pointerId: number, positionMs: number) {
    if (this.owns(cueId, pointerId)) this.publish({ phase: "dragging", cueId, pointerId, positionMs });
  }
  release(cueId: string, pointerId: number, positionMs: number, commit: (ms: number) => number | null) {
    if (this.owns(cueId, pointerId)) this.commit(cueId, positionMs, commit);
  }
  cancel(cueId: string, pointerId: number) {
    if (this.owns(cueId, pointerId)) this.publish(IDLE);
  }
  commit(cueId: string, positionMs: number, commit: (ms: number) => number | null) {
    const operationId = commit(positionMs);
    this.publish(operationId === null ? IDLE : { phase: "pending", cueId, operationId, positionMs });
  }
  private owns(cueId: string, pointerId: number) {
    const s = this.state;
    return s.phase === "dragging" && s.cueId === cueId && s.pointerId === pointerId;
  }
}
