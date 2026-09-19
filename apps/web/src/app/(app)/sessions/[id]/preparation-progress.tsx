import { Check, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { preparationSteps, type Preparation } from "./preparation";
import type { Slot } from "./types";

export function PreparationProgress({
  status,
  loaded,
  slot,
}: {
  status: Preparation;
  loaded: boolean;
  slot?: Slot;
}) {
  const steps = preparationSteps(loaded, slot, status.busy);
  const active = steps.find((step) => step.active);
  return (
    <div className="min-h-32 w-full py-2">
      <ol className="mx-auto grid max-w-sm grid-cols-2 gap-x-4 gap-y-3 text-xs" aria-label="Show preparation">
        {steps.map((step) => (
          <li
            key={step.id}
            className={`flex items-center gap-3 ${step.done ? "text-zinc-300" : "text-zinc-500"}`}
          >
            {step.done ? (
              <Check className="size-4 text-lamp" aria-hidden="true" />
            ) : step.active ? (
              <LoaderCircle
                className="size-4 animate-spin text-lamp motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <span className="m-1 size-2 rounded-full border border-zinc-600" aria-hidden="true" />
            )}
            {step.label}
          </li>
        ))}
      </ol>
      <p role="status" className="mt-4 min-h-10 text-center text-xs leading-relaxed text-zinc-400">
        {status.ready ? (
          "Your opening is ready. Press Play show to listen."
        ) : status.busy ? (
          <>
            {active?.id === "opening"
              ? "Your DJ is writing and recording the opening."
              : "You’ll press Play when it’s ready."}
            {active && <StepElapsed key={active.id} />}
          </>
        ) : (
          "Use the retry action to pick up where you left off."
        )}
      </p>
    </div>
  );
}

/** Remount on each step (and on retry) so this is time spent on the current task. */
function StepElapsed() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return seconds >= 10 ? <span className="mt-1 block">{seconds}s on this step</span> : null;
}
