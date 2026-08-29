"use client";

import { Mic, Square } from "lucide-react";
import { DjPicker } from "./dj-picker";
import type { SpotifyAccount } from "./spotify-account";
import { Card, focusRing, Label, SpotifyMark } from "./ui";
import type { DeviceStatus } from "./use-spotify-device";
import type { Dj } from "./voice-store";

/**
 * The on-air panel: the lamp and the one button at the top, who's on the mic below, and the
 * Spotify account as a single line at the foot. "Go on air" is the only verb — it registers this
 * tab as the Spotify device on the way if it isn't yet ("Activating…"), so the player is never
 * a separate step the listener has to know about.
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
  const who = account ? (account.displayName ?? account.spotifyUserId) : null;

  return (
    <Card className="flex flex-col divide-y divide-zinc-800/80 p-0">
      {/* the lamp and the verb */}
      <div className="flex min-h-16 items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className={`lamp size-2.5 rounded-full ${running ? "on" : ""} ${talking ? "talking" : ""}`}
          />
          <Label className={running ? "text-lamp" : ""}>{running ? "On air" : "Off air"}</Label>
        </div>
        {running ? (
          <button
            type="button"
            onClick={onStop}
            className={`flex items-center gap-2 rounded-full bg-zinc-100 px-5 py-2 text-sm font-semibold text-black transition hover:bg-white ${focusRing}`}
          >
            <Square className="size-3.5" fill="currentColor" strokeWidth={0} aria-hidden="true" />
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={onGo}
            disabled={!canGo || arming}
            className={`rounded-full bg-lamp px-5 py-2 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100 ${focusRing}`}
          >
            {arming ? "Activating…" : "Go on air"}
          </button>
        )}
      </div>
      {device.kind === "error" && (
        <p className="px-4 py-2 text-xs text-red-400">
          This tab couldn&rsquo;t become the player: {device.message}
        </p>
      )}

      {/* who's on the mic */}
      <div className="flex min-h-14 items-center justify-between gap-3 py-2 pr-2 pl-4">
        <div className="flex items-center gap-2.5">
          <Mic className="size-4 text-zinc-500" strokeWidth={1.75} aria-hidden="true" />
          <Label>On the mic</Label>
        </div>
        <DjPicker value={dj} onChange={onDj} />
      </div>

      {/* the account, one line */}
      <div className="flex min-h-12 items-center gap-2.5 py-2 pr-3 pl-4 text-sm">
        <SpotifyMark className={`size-4 shrink-0 ${account ? "text-[#1DB954]" : "text-zinc-600"}`} />
        {account ? (
          <>
            <span className="min-w-0 flex-1 truncate text-zinc-300">
              {who}
              <span className={`ml-2 text-xs ${premium ? "text-zinc-500" : "text-amber-300/90"}`}>
                {premium ? "Premium" : `${account.product ?? "unknown plan"} — playback needs Premium`}
              </span>
            </span>
            <button
              type="button"
              onClick={onDisconnect}
              className={`rounded-full px-2 py-1 text-xs text-zinc-500 transition hover:text-zinc-200 ${focusRing}`}
            >
              Disconnect
            </button>
          </>
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate text-zinc-500">Playback needs a Premium account</span>
            <button
              type="button"
              onClick={onConnect}
              className={`rounded-full bg-[#1DB954] px-3.5 py-1.5 text-xs font-semibold text-black transition hover:bg-[#1ed760] ${focusRing}`}
            >
              Connect with Spotify
            </button>
          </>
        )}
      </div>
    </Card>
  );
}
