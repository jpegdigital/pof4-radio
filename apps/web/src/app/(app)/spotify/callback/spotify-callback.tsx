"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { finishLogin } from "../../lib/spotify-account";

/** Where the login began (the session page sets it); home otherwise. */
export const RETURN_KEY = "radio.spotify.return";

export function SpotifyCallback({ clientId }: { clientId: string }) {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    finishLogin(clientId, new URLSearchParams(location.search))
      .then(() => {
        const back = sessionStorage.getItem(RETURN_KEY) ?? "/";
        sessionStorage.removeItem(RETURN_KEY);
        location.replace(back);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [clientId]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8 text-sm">
      {error ? (
        <p className="text-red-400">
          Spotify said: {error} —{" "}
          <Link href="/" className="underline">
            back home
          </Link>
        </p>
      ) : (
        <p className="text-zinc-400">Connecting Spotify…</p>
      )}
    </div>
  );
}
