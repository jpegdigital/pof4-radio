import { exchangeCode, me } from "@radio/spotify";
import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { clientConfig } from "@/lib/spotify";

/**
 * Spotify sends the browser back here with `code` + `state`. Exchange the code, look up
 * who it is, store the tokens (one row — this is the station's account), go home.
 * The request arrives as a browser navigation carrying the pof4 cookie, so Guard's gate
 * has already run: only a signed-in person can connect an account.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const home = new URL("/", env().SPOTIFY_REDIRECT_URI);
  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/?spotify_error=${encodeURIComponent(reason)}`, home));

  const jar = await cookies();
  const expected = jar.get("spotify_oauth_state")?.value;
  jar.delete("spotify_oauth_state");

  if (q.get("error")) return fail(q.get("error")!);
  const code = q.get("code");
  if (!code || !expected || q.get("state") !== expected) return fail("state_mismatch");

  const t = await exchangeCode(clientConfig(), code, env().SPOTIFY_REDIRECT_URI);
  if (!t.refresh_token) return fail("no_refresh_token");
  const who = await me(t.access_token);

  await db().saveSpotifyAccount({
    spotifyUserId: who.id,
    displayName: who.display_name,
    product: who.product ?? null,
    scope: t.scope ?? "",
    refreshToken: t.refresh_token,
    accessToken: t.access_token,
    expiresAt: new Date(Date.now() + t.expires_in * 1000),
  });
  return NextResponse.redirect(home);
}
