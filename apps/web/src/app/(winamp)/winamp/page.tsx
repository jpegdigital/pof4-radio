import { summarize } from "@radio/dj";
import { cookies } from "next/headers";
import { IDENTITY_COOKIE, parseIdentity } from "@/components/station/spotify-account";
import { Winamp } from "@/components/winamp/winamp";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { loadVoices } from "@/lib/voices";

export const dynamic = "force-dynamic";

/**
 * The station in a Winamp skin — the same server contribution as the home page (the Spotify
 * client id, the roster, the past shows, who is connected), a different face on it.
 */
export default async function Page() {
  const [voices, past, jar] = await Promise.all([loadVoices(), db().listStations(20), cookies()]);
  return (
    <Winamp
      clientId={env().SPOTIFY_CLIENT_ID}
      identity={parseIdentity(jar.get(IDENTITY_COOKIE)?.value)}
      djs={voices.map(summarize)}
      stations={past.map((s) => ({
        stationId: s.id,
        prompt: s.prompt,
        dj: s.dj,
        segmentCount: s.segmentCount,
        updatedAt: s.updatedAt.toISOString(),
      }))}
    />
  );
}
