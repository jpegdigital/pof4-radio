import { authorizeUrl } from "@radio/spotify";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";

/**
 * "Connect Spotify": send the (Guard-authenticated) browser to Spotify's consent page.
 * `state` is a nonce kept in a short-lived cookie; the callback checks it (CSRF).
 */
export async function GET() {
  const state = crypto.randomUUID();
  const jar = await cookies();
  jar.set("spotify_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 10 * 60,
    path: "/api/spotify",
  });
  const e = env();
  return NextResponse.redirect(
    authorizeUrl({ clientId: e.SPOTIFY_CLIENT_ID }, e.SPOTIFY_REDIRECT_URI, state),
  );
}
