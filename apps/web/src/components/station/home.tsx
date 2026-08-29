"use client";

import { useEffect, useState } from "react";
import { beginLogin, clearAccount, loadAccount, type SpotifyAccount } from "./spotify-account";
import { Station } from "./station";

/** The account panel + the station. The account is this browser's own (localStorage). */
export function Home({ clientId }: { clientId: string }) {
  const [account, setAccount] = useState<SpotifyAccount | null>(null);
  useEffect(() => {
    const stored = loadAccount();
    queueMicrotask(() => setAccount(stored)); // after hydration, not during it
  }, []);
  const premium = account?.product === "premium";

  const disconnect = () => {
    clearAccount();
    setAccount(null);
  };

  return (
    <>
      <section className="rounded-xl border border-zinc-800 p-4">
        <h2 className="mb-2 text-sm font-medium text-zinc-400">Spotify account</h2>
        {account ? (
          <p className="text-sm">
            Connected as <b>{account.displayName ?? account.spotifyUserId}</b>{" "}
            <span className="text-zinc-500">({account.product ?? "unknown plan"})</span>
            {!premium && <span className="ml-2 text-amber-400">— playback needs Premium</span>}
            <button
              type="button"
              onClick={disconnect}
              className="ml-3 text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
            >
              disconnect
            </button>
          </p>
        ) : (
          <button
            type="button"
            onClick={() => void beginLogin(clientId)}
            className="inline-block rounded-md bg-green-500 px-4 py-2 text-sm font-medium text-black"
          >
            Connect Spotify
          </button>
        )}
      </section>

      <section className="rounded-xl border border-zinc-800 p-4">
        <h2 className="mb-2 text-sm font-medium text-zinc-400">On air</h2>
        <Station enabled={premium} clientId={clientId} />
      </section>
    </>
  );
}
