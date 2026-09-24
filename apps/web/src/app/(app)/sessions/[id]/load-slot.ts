import { getClip } from "../../lib/voice-cache";
import { planSlot } from "@/lib/playback/plan";
import type { PreparedSlot } from "@/lib/playback/mix";
import type { Cue, Slot } from "./types";

export const trackUrlOf = (sessionId: string, seq: number) => `/api/sessions/${sessionId}/slots/${seq}/track`;
export const playbackId = (sessionId: string, cue: Cue) =>
  `${sessionId}/${cue.seq}/${cue.pick.id}/${cue.clipKey ?? "segue"}`;

/** Translate the show's wire document and HTTP cache into a playable mix. */
export async function loadSlot(
  sessionId: string,
  cue: Cue,
  signal: AbortSignal,
  onSlot: (slot: Slot) => void,
): Promise<PreparedSlot> {
  const song = async () => {
    const url = trackUrlOf(sessionId, cue.seq);
    if (!cue.held) {
      const response = await fetch(url, { method: "POST", signal });
      const data = (await response.json()) as { held?: boolean; error?: string };
      if (!response.ok || !data.held) throw new Error(data.error ?? `HTTP ${response.status}`);
      signal.throwIfAborted();
      onSlot({ ...cue, held: true });
    }
    return getClip(url);
  };
  const voice = cue.clipKey
    ? getClip(`/api/sessions/${sessionId}/slots/${cue.seq}/clip?take=${encodeURIComponent(cue.clipKey)}`)
    : Promise.resolve(null);
  const [rec, mic] = await Promise.all([song(), voice]);
  signal.throwIfAborted();
  if ("error" in rec) throw new Error(rec.error);
  if (mic && "error" in mic) throw new Error(mic.error);
  const plan = planSlot({
    kind: cue.kind,
    clipMs: mic?.durationMs ?? null,
    recordUnderMs: cue.recordUnderMs,
    finishAtMs: cue.finishAtMs,
    voiceInMs: cue.voiceInMs,
    rampMs: cue.chart?.postTiming === "beyond_5" ? undefined : cue.chart?.rampMs,
    legalIdChars: cue.legalId?.length ?? 0,
  });
  return {
    id: playbackId(sessionId, cue),
    plan,
    songUrl: rec.url,
    songDurationMs: rec.durationMs,
    voiceUrl: mic?.url ?? null,
    bedUrl: plan.bed ? "/bed.mp3" : null,
  };
}

/** Only an uninterrupted voice completion for this exact take can acknowledge its news. */
export function acknowledgeVoice(sessionId: string, cue: Cue) {
  if (!cue.news?.words || !cue.clipKey) return;
  void fetch(`/api/sessions/${sessionId}/slots/${cue.seq}/news`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    body: JSON.stringify({ clipKey: cue.clipKey }),
  })
    .then((response) => {
      if (!response.ok) console.warn(`[deck] news acknowledgment HTTP ${response.status}`);
    })
    .catch((error: unknown) => console.warn("[deck] news acknowledgment:", error));
}
