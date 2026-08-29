"use client";

import { useEffect, useState } from "react";
import { beginLogin, clearAccount, loadAccount, type SpotifyAccount } from "./spotify-account";
import { Station } from "./station";
import { Card, focusRing, SpotifyMark } from "./ui";

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
      <Card className="flex items-center gap-3">
        <SpotifyMark className={`size-6 shrink-0 ${account ? "text-[#1DB954]" : "text-zinc-600"}`} />
        {account ? (
          <>
            <div className="min-w-0 flex-1 text-sm">
              <div className="truncate">{account.displayName ?? account.spotifyUserId}</div>
              <div className="text-xs text-zinc-500">
                {premium ? "Premium" : `${account.product ?? "unknown plan"} — playback needs Premium`}
              </div>
            </div>
            <button
              type="button"
              onClick={disconnect}
              className={`text-xs text-zinc-500 hover:text-zinc-200 ${focusRing}`}
            >
              Disconnect
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => void beginLogin(clientId)}
            className={`ml-auto rounded-full bg-[#1DB954] px-4 py-2 text-sm font-semibold text-black hover:bg-[#1ed760] ${focusRing}`}
          >
            Connect with Spotify
          </button>
        )}
      </Card>

      <Station enabled={premium} clientId={clientId} />
    </>
  );
}
