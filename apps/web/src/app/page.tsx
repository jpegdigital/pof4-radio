import { AutoRefresh } from "@/components/auto-refresh";
import { Player } from "@/components/player";
import { RequestForm } from "@/components/request-form";
import { db } from "@/lib/db";
import { userAccount } from "@/lib/spotify";

export const dynamic = "force-dynamic";

/**
 * The station. Three things on one page:
 *   1. the Spotify account (connect once; must be Premium for playback)
 *   2. "what do you want to hear" → a segment request → the worker's DJ plans it
 *   3. the player: takes the oldest `ready` segment, speaks the intro, plays the tracks,
 *      speaks the outro, and asks for the next one as soon as it starts — always one ahead.
 * Freshness is a 4-second refresh (AutoRefresh) — NOTIFY→SSE can replace it later.
 */
export default async function Home({ searchParams }: PageProps<"/">) {
  const { spotify_error } = await searchParams;
  const [account, segments] = await Promise.all([userAccount(), db().listSegments(12)]);
  const premium = account?.product === "premium";
  const lastPrompt = segments[0]?.listenerPrompt ?? "";

  return (
    <>
      <AutoRefresh everyMs={4000} />

      <section className="rounded-xl border border-zinc-800 p-4">
        <h2 className="mb-2 text-sm font-medium text-zinc-400">Spotify account</h2>
        {account ? (
          <p className="text-sm">
            Connected as <b>{account.displayName ?? account.spotifyUserId}</b>{" "}
            <span className="text-zinc-500">({account.product ?? "unknown plan"})</span>
            {!premium && <span className="ml-2 text-amber-400">— playback needs Premium</span>}
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
        <h2 className="mb-2 text-sm font-medium text-zinc-400">What do you want to hear?</h2>
        <RequestForm initial={lastPrompt} />
      </section>

      <section className="rounded-xl border border-zinc-800 p-4">
        <h2 className="mb-2 text-sm font-medium text-zinc-400">On air</h2>
        <Player segments={segments} enabled={premium} />
      </section>
    </>
  );
}
