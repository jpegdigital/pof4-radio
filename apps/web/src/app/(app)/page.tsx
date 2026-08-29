import { summarize } from "@radio/dj";
import { cookies } from "next/headers";
import { Home } from "@/components/station/home";
import { IDENTITY_COOKIE, parseIdentity } from "@/components/station/spotify-account";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { loadVoices } from "@/lib/voices";

export const dynamic = "force-dynamic";

/**
 * The station. The server contributes the Spotify client id, the DJ roster (names and ids from
 * `settings.voices` — the tuning stays server-side), the past shows to resume, and who is
 * connected to Spotify (the identity cookie — name and product, never a token), all ready on
 * first paint; everything else — the tokens, the loop, the DJ requests, the voice, the
 * history — lives in the browser (components/station).
 */
export default async function Page() {
  const [voices, past, jar] = await Promise.all([loadVoices(), db().listStations(20), cookies()]);
  return (
    <Home
      clientId={env().SPOTIFY_CLIENT_ID}
      identity={parseIdentity(jar.get(IDENTITY_COOKIE)?.value)}
      djs={voices.map(summarize)}
      stations={past.map((s) => ({
        stationId: s.id,
        prompt: s.prompt,
        segmentCount: s.segmentCount,
        updatedAt: s.updatedAt.toISOString(),
      }))}
    />
  );
}
