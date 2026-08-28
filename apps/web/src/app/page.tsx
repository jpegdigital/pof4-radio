import { Station } from "@/components/station/station";
import { userAccount } from "@/lib/spotify";

export const dynamic = "force-dynamic";

/**
 * The station. The server only knows the Spotify account; everything else — the loop, the
 * DJ requests, the voice, the history — is driven from the browser (components/station).
 */
export default async function Home({ searchParams }: PageProps<"/">) {
  const { spotify_error } = await searchParams;
  const account = await userAccount();
  const premium = account?.product === "premium";

  return (
    <>
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
        <h2 className="mb-2 text-sm font-medium text-zinc-400">On air</h2>
        <Station enabled={premium} />
      </section>
    </>
  );
}
