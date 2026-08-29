"use client";

import { LogOut, Mic, Square } from "lucide-react";
import { DjPicker } from "./dj-picker";
import type { SpotifyAccount } from "./spotify-account";
import { Card, focusRing, Label, SpotifyMark } from "./ui";
import type { DeviceStatus } from "./use-spotify-device";
import type { Dj } from "./voice-store";

/**
 * The on-air panel. Top line is indicators: the lamp (left) and the Spotify account (right, with
 * a sign-out glyph; a Connect button until there is one). Bottom line is controls: who's on the
 * mic (left) and the one button (right). "Go on air" registers this tab as the Spotify device on
 * the way if it isn't yet ("Activating…"), so the player is never a separate step.
 */
export function OnAir({
  running,
  talking,
  arming,
  canGo,
  onGo,
  onStop,
  device,
  dj,
  onDj,
  account,
  onConnect,
  onDisconnect,
}: {
  running: boolean;
  talking: boolean;
  /** Go on air was pressed and the tab is still registering as the device. */
  arming: boolean;
  canGo: boolean;
  onGo: () => void;
  onStop: () => void;
  device: DeviceStatus;
  dj: Dj;
  onDj: (d: Dj) => void;
  account: SpotifyAccount | null;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const premium = account?.product === "premium";

  return (
    <Card className="flex flex-col gap-5">
      {/* indicators */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className={`lamp size-2.5 rounded-full ${running ? "on" : ""} ${talking ? "talking" : ""}`}
          />
          <Label className={running ? "text-lamp" : ""}>{running ? "On air" : "Off air"}</Label>
        </div>
        {account ? (
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <SpotifyMark className="size-4 shrink-0 text-[#1DB954]" />
            <span className="truncate text-zinc-300">{account.displayName ?? account.spotifyUserId}</span>
            {!premium && <span className="shrink-0 text-xs text-amber-300/90">not Premium</span>}
            <button
              type="button"
              onClick={onDisconnect}
              aria-label="Sign out of Spotify"
              title="Sign out of Spotify"
              className={`-mr-1.5 rounded-full p-1.5 text-zinc-500 transition hover:text-zinc-200 ${focusRing}`}
            >
              <LogOut className="size-4" strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onConnect}
            className={`flex items-center gap-2 rounded-full bg-[#1DB954] px-3.5 py-1.5 text-xs font-semibold text-black transition hover:bg-[#1ed760] ${focusRing}`}
          >
            <SpotifyMark className="size-3.5" />
            Connect
          </button>
        )}
      </div>

      {/* controls */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <Mic className="size-4 shrink-0 text-zinc-500" strokeWidth={1.75} aria-hidden="true" />
          <Label className="shrink-0">On the mic</Label>
          <DjPicker value={dj} onChange={onDj} />
        </div>
        {running ? (
          <button
            type="button"
            onClick={onStop}
            className={`flex shrink-0 items-center gap-2 rounded-full bg-zinc-100 px-5 py-2 text-sm font-semibold text-black transition hover:bg-white ${focusRing}`}
          >
            <Square className="size-3.5" fill="currentColor" strokeWidth={0} aria-hidden="true" />
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={onGo}
            disabled={!canGo || arming}
            className={`shrink-0 rounded-full bg-lamp px-5 py-2 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100 ${focusRing}`}
          >
            {arming ? "Activating…" : "Go on air"}
          </button>
        )}
      </div>

      {device.kind === "error" && (
        <p className="-mt-2 text-xs text-red-400">
          This tab couldn&rsquo;t become the player: {device.message}
        </p>
      )}
      {!account && <p className="-mt-2 text-xs text-zinc-500">Playback needs a Spotify Premium account.</p>}
    </Card>
  );
}
