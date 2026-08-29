import { Home } from "@/components/station/home";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * The station. The server contributes only the Spotify client id; everything else — the
 * account, the loop, the DJ requests, the voice, the history — lives in the browser
 * (components/station).
 */
export default function Page() {
  return <Home clientId={env().SPOTIFY_CLIENT_ID} />;
}
