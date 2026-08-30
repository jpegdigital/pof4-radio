import { cookies } from "next/headers";
import { IDENTITY_COOKIE, parseIdentity } from "@/components/station/spotify-account";
import { env } from "@/lib/env";
import { Program } from "./program";

export const dynamic = "force-dynamic";

/**
 * The program. The server contributes the Spotify client id and who is connected (the identity
 * cookie — never a token); the program itself is read from /program/make/program.json in the browser.
 */
export default async function Page() {
  const jar = await cookies();
  return (
    <Program clientId={env().SPOTIFY_CLIENT_ID} identity={parseIdentity(jar.get(IDENTITY_COOKIE)?.value)} />
  );
}
