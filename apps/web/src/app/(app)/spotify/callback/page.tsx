import { env } from "@/lib/env";
import { SpotifyCallback } from "./spotify-callback";

export const dynamic = "force-dynamic";

/** Spotify sends the browser back here; the browser finishes the PKCE exchange itself. */
export default function Page() {
  return <SpotifyCallback clientId={env().SPOTIFY_CLIENT_ID} />;
}
