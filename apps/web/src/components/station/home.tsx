"use client";

import type { Identity } from "@radio/dj";
import { useEffect, useState } from "react";
import type { StationSummary } from "./resume-picker";
import {
  beginLogin,
  clearAccount,
  identityOf,
  loadAccount,
  rememberIdentity,
  type SpotifyAccount,
  type SpotifyIdentity,
} from "./spotify-account";
import { Station } from "./station";
import type { Dj } from "./voice-store";

/**
 * Owns this browser's Spotify account and hands it to the station. Who is connected comes with
 * the page (the identity cookie) and paints at once; the tokens come from localStorage after
 * hydration. If the storage is gone but the cookie isn't (cleared site data), the cookie goes too.
 */
export function Home({
  clientId,
  identity: initialIdentity,
  station,
  djs,
  stations,
}: {
  clientId: string;
  identity: SpotifyIdentity | null;
  /** The station's call letters and name, or null until /settings has them. */
  station: Identity | null;
  djs: Dj[];
  stations: StationSummary[];
}) {
  const [identity, setIdentity] = useState(initialIdentity);
  const [account, setAccount] = useState<SpotifyAccount | null>(null);
  useEffect(() => {
    const stored = loadAccount();
    queueMicrotask(() => {
      // after hydration, not during it
      setAccount(stored);
      if (stored) {
        setIdentity(identityOf(stored));
        if (!initialIdentity) rememberIdentity(stored); // a browser from before the cookie
      } else if (initialIdentity) {
        clearAccount();
        setIdentity(null);
      }
    });
  }, [initialIdentity]);

  return (
    <>
      {!station && (
        <p className="text-xs text-amber-300/90">
          The station has no identity yet — fill call letters, city and the on-air name on /settings before
          going on air.
        </p>
      )}
      <Station
        clientId={clientId}
        identity={identity}
        account={account}
        djs={djs}
        stations={stations}
        onConnect={() => void beginLogin(clientId)}
        onDisconnect={() => {
          clearAccount();
          setAccount(null);
          setIdentity(null);
        }}
      />
    </>
  );
}
