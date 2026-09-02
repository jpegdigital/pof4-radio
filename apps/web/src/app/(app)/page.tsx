import { summarize } from "@radio/dj";
import { db } from "@/lib/db";
import { loadVoices } from "@/lib/voices";
import { HomeDesk, type SessionSummary } from "./home-desk";

export const dynamic = "force-dynamic";

interface SessionRow {
  id: string;
  prompt: string;
  voice_id: string;
  created_at: Date;
  segments: string;
}

/** How many earlier sessions the desk shows. */
const LOG_LENGTH = 20;

/**
 * The home. The server contributes the DJ roster (names and ids from `settings.voices` — the
 * tuning stays server-side) and the log of earlier sessions, both ready on first paint;
 * the form and the redirect are the browser's (home-desk.tsx).
 */
export default async function HomePage() {
  const [voices, { rows }] = await Promise.all([
    loadVoices(),
    db().pool.query<SessionRow>(
      `select s.id, s.prompt, s.voice_id, s.created_at, count(g.tracks) as segments
       from session s left join session_segment g on g.session_id = s.id
       group by s.id order by s.created_at desc limit $1`,
      [LOG_LENGTH],
    ),
  ]);
  const sessions: SessionSummary[] = rows.map((r) => ({
    sessionId: r.id,
    prompt: r.prompt,
    dj: (voices.find((v) => v.id === r.voice_id) ?? voices[0])?.name ?? "no voice",
    segments: Number(r.segments),
    createdAt: r.created_at.toISOString(),
  }));
  return <HomeDesk djs={voices.map(summarize)} sessions={sessions} />;
}
