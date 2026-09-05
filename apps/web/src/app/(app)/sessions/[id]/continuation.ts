/** An ended track can hand off later, unless the listener paused or picked another cue. */
export function canContinue(
  endedSeq: number | null,
  currentSeq: number | null,
  paused: boolean,
  nextReady: boolean,
): boolean {
  return endedSeq !== null && endedSeq === currentSeq && !paused && nextReady;
}
