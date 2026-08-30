"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { finishLogin } from "@/components/station/spotify-account";

export function SpotifyCallback({ clientId }: { clientId: string }) {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    finishLogin(clientId, new URLSearchParams(location.search))
      .then(() => location.replace("/"))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [clientId]);

  return (
    <section className="rounded-xl border border-zinc-800 p-4 text-sm">
      {error ? (
        <p className="text-red-400">
          Spotify said: {error} —{" "}
          <Link href="/" className="underline">
            back to the station
          </Link>
        </p>
      ) : (
        <p className="text-zinc-400">Connecting Spotify…</p>
      )}
    </section>
  );
}
