import { loadVoices } from "@/lib/settings";
import { sessionLog } from "../api/sessions/show-store";
import { HomeDesk, type SessionSummary } from "./home-desk";

export const dynamic = "force-dynamic";

/** How many earlier sessions the desk shows. */
const LOG_LENGTH = 20;

/**
 * The home. The server contributes the DJ roster (names and ids from `settings.voices` — the
 * tuning stays server-side) and the log of earlier sessions, both ready on first paint;
 * the form and the redirect are the browser's (home-desk.tsx).
 */
export default async function HomePage() {
  const [voices, log] = await Promise.all([loadVoices(), sessionLog(LOG_LENGTH)]);
  const sessions: SessionSummary[] = log.map((s) => ({
    sessionId: s.id,
    prompt: s.prompt,
    dj: (voices.find((v) => v.id === s.voiceId) ?? voices[0])?.name ?? "no voice",
    slots: s.slots,
    createdAt: s.createdAt.toISOString(),
  }));
  return (
    <HomeDesk djs={voices.map((v) => ({ id: v.id, name: v.name, gender: v.gender }))} sessions={sessions} />
  );
}
