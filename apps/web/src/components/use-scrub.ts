import { type KeyboardEvent, type PointerEvent, useState, useSyncExternalStore } from "react";
import { positionAt, ScrubGesture, type ScrubSnapshot } from "./scrub";

/** React supplies geometry/events; the gesture model owns pointer identity and pending targets. */
export function useScrub(snapshot: ScrubSnapshot, onCommit: ((ms: number) => number | null) | null) {
  const [gesture] = useState(() => new ScrubGesture());
  useSyncExternalStore(gesture.subscribe, gesture.getSnapshot, gesture.getSnapshot);
  const shown = onCommit ? gesture.shown(snapshot) : snapshot.positionMs;
  const msAt = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return positionAt(event.clientX, bounds.left, bounds.width, snapshot.durationMs);
  };
  const cancel = (event: PointerEvent<HTMLDivElement>) => gesture.cancel(snapshot.cueId, event.pointerId);
  const handlers = onCommit
    ? {
        onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
          if (!event.isPrimary || event.button !== 0) return;
          const ms = msAt(event);
          if (ms === null || !gesture.begin(snapshot.cueId, event.pointerId, ms)) return;
          event.currentTarget.setPointerCapture(event.pointerId);
        },
        onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
          const ms = msAt(event);
          if (ms !== null) gesture.move(snapshot.cueId, event.pointerId, ms);
        },
        onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
          const ms = msAt(event);
          if (ms !== null) gesture.release(snapshot.cueId, event.pointerId, ms, onCommit);
          else cancel(event);
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        },
        onPointerCancel: cancel,
        onLostPointerCapture: cancel,
        onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
          let ms: number;
          if (event.key === "ArrowLeft") ms = shown - 1000;
          else if (event.key === "ArrowRight") ms = shown + 1000;
          else if (event.key === "Home") ms = 0;
          else if (event.key === "End") ms = snapshot.durationMs;
          else return;
          event.preventDefault();
          gesture.commit(snapshot.cueId, Math.max(0, Math.min(snapshot.durationMs, ms)), onCommit);
        },
      }
    : null;
  return { shown, handlers };
}
