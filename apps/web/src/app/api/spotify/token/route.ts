import { userAccount } from "@/lib/spotify";

/**
 * The player's token endpoint: the Web Playback SDK calls `getOAuthToken` on init and again
 * whenever its token lapses. Behind Guard like everything else, so only a signed-in browser
 * can pull the station's Spotify token.
 */
export async function GET() {
  const account = await userAccount();
  if (!account) return Response.json({ error: "spotify_not_connected" }, { status: 404 });
  return Response.json(
    { access_token: account.accessToken, expires_at: account.expiresAt.toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
