/** Spatial navigation for a directional remote; native form and slider keys remain native. */
export function navigateRemote(event: KeyboardEvent, root: HTMLElement) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.matches("input, textarea, select, [contenteditable=true]"))
    return;
  if (active?.getAttribute("role") === "slider" && ["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], summary, [tabindex="0"]'),
  ).filter(
    (element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden",
  );
  if (!candidates.length) return;
  if (!(active instanceof HTMLElement) || !root.contains(active)) {
    event.preventDefault();
    (root.querySelector<HTMLElement>(".player-play:not(:disabled)") ?? candidates[0]).focus();
    return;
  }
  const origin = active.getBoundingClientRect();
  const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
  const sign = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
  const ox = origin.left + origin.width / 2;
  const oy = origin.top + origin.height / 2;
  const ranked = candidates
    .filter((element) => element !== active)
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const dx = rect.left + rect.width / 2 - ox;
      const dy = rect.top + rect.height / 2 - oy;
      const forward = (horizontal ? dx : dy) * sign;
      const sideways = Math.abs(horizontal ? dy : dx);
      return { element, forward, score: forward + sideways * 3 };
    })
    .filter(({ forward }) => forward > 1)
    .sort((a, b) => a.score - b.score);
  if (ranked[0]) {
    event.preventDefault();
    ranked[0].element.focus({ preventScroll: true });
    ranked[0].element.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}
