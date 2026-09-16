import { Check, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { Preparation } from "./preparation";
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
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!status.busy) return;
    const started = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [status.busy]);
  const steps = [
    { label: "Show created", done: loaded },
    { label: "Tracks selected", done: !!slot },
    { label: "Opening prepared", done: !!slot?.voiced },
    { label: "Track ready", done: !!slot?.held },
  ];
  const active = steps.findIndex((step) => !step.done);
  return (
    <div className="min-h-32 w-full py-2">
      <ol className="mx-auto grid max-w-sm grid-cols-2 gap-x-4 gap-y-3 text-xs" aria-label="Show preparation">
        {steps.map((step, index) => (
          <li
            key={step.label}
            className={`flex items-center gap-3 ${step.done ? "text-zinc-300" : "text-zinc-500"}`}
          >
            {step.done ? (
              <Check className="size-4 text-lamp" aria-hidden="true" />
            ) : index === active && status.busy ? (
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
      <p className="mt-4 min-h-10 text-center text-xs leading-relaxed text-zinc-400">
        {status.ready ? (
          "Your opening is ready. Press Play show to listen."
        ) : status.busy ? (
          <>
            You’ll press Play when it’s ready.
            {seconds >= 10 && (
              <span className="mt-1 block">
                {seconds >= 30 ? "This is taking longer than usual. " : ""}
                {seconds}s elapsed
              </span>
            )}
          </>
        ) : (
          "Use the retry action to pick up where you left off."
        )}
      </p>
    </div>
  );
}
