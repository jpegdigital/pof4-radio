"use client";

import { useEffect, useState } from "react";
import { beginLogin, clearAccount, loadAccount, type SpotifyAccount } from "./spotify-account";
import { Station } from "./station";

/** Owns this browser's Spotify account (localStorage) and hands it to the station. */
export function Home({ clientId }: { clientId: string }) {
  const [account, setAccount] = useState<SpotifyAccount | null>(null);
  useEffect(() => {
    const stored = loadAccount();
    queueMicrotask(() => setAccount(stored)); // after hydration, not during it
  }, []);

  return (
    <Station
      clientId={clientId}
      account={account}
      onConnect={() => void beginLogin(clientId)}
      onDisconnect={() => {
        clearAccount();
        setAccount(null);
      }}
    />
  );
}
