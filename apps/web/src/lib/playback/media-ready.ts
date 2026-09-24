/** Prepare the actual playback element before starting the mix clock and its gain ramps. */
export function prepareMedia(
  media: HTMLAudioElement,
  url: string,
  positionMs: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let positioned = false;
    const events = ["loadedmetadata", "canplay", "seeked"];
    const cleanup = () => {
      for (const event of events) media.removeEventListener(event, check);
      media.removeEventListener("error", failed);
      signal.removeEventListener("abort", aborted);
    };
    const failed = () => {
      cleanup();
      reject(new Error(media.error?.message || "Could not prepare audio for playback"));
    };
    const aborted = () => {
      cleanup();
      reject(new DOMException("Playback preparation cancelled", "AbortError"));
    };
    const check = () => {
      if (media.error) return failed();
      if (media.readyState < 1) return;
      if (!positioned) {
        positioned = true;
        if (media.currentTime !== positionMs / 1000) media.currentTime = positionMs / 1000;
      }
      // At the exact end there can be no future frames. A paused placement there is still ready.
      const atEnd = Number.isFinite(media.duration) && positionMs / 1000 >= media.duration;
      if (media.seeking || media.readyState < (atEnd ? 2 : 3)) return;
      cleanup();
      resolve();
    };
    if (signal.aborted) return aborted();
    for (const event of events) media.addEventListener(event, check);
    media.addEventListener("error", failed);
    signal.addEventListener("abort", aborted, { once: true });
    if (media.getAttribute("src") !== url || media.error) {
      media.src = url;
      media.load();
    }
    check();
  });
}
