import { Player } from "@/components/player";
import { search, userAccount } from "@/lib/spotify";

export const dynamic = "force-dynamic";

/**
 * The prototype's one page. Proves the three connections end to end:
 *   1. Postgres — is a Spotify account connected? (spotify_account row)
 *   2. Spotify Web API — a fixed search, via the app (client-credentials) token
 *   3. Spotify playback — the Web Playback SDK in this browser, via the user's token
 * The DJ will replace the fixed query with Claude's picks; the player stays.
 */
const FIXED_QUERY = "artist:Khruangbin";

export default async function Home({ searchParams }: PageProps<"/">) {
  const { spotify_error } = await searchParams;
  const [account, tracks] = await Promise.all([
    userAccount(),
    search(FIXED_QUERY, 10).catch((err: unknown) => ({ error: String(err) })),
  ]);

  return (
    <>
      <section className="rounded-xl border border-zinc-800 p-4">
        <h2 className="mb-2 text-sm font-medium text-zinc-400">Spotify account</h2>
        {account ? (
          <p className="text-sm">
            Connected as <b>{account.displayName ?? account.spotifyUserId}</b>{" "}
            <span className="text-zinc-500">({account.product ?? "unknown plan"})</span>
            {account.product !== "premium" && (
              <span className="ml-2 text-amber-400">— playback needs Premium</span>
            )}
          </p>
        ) : (
          <a
            href="/api/spotify/login"
            className="inline-block rounded-md bg-green-500 px-4 py-2 text-sm font-medium text-black"
          >
            Connect Spotify
          </a>
        )}
        {spotify_error && <p className="mt-2 text-sm text-red-400">Spotify said: {spotify_error}</p>}
      </section>

      <section className="rounded-xl border border-zinc-800 p-4">
        <h2 className="mb-2 text-sm font-medium text-zinc-400">
          Search <code className="text-zinc-300">{FIXED_QUERY}</code>
        </h2>
        {"error" in tracks ? (
          <p className="text-sm text-red-400">{tracks.error}</p>
        ) : (
          <Player tracks={tracks} enabled={account?.product === "premium"} />
        )}
      </section>
    </>
  );
}
