"use client";

import { Radio } from "lucide-react";
import type { ReactNode } from "react";
import { DjPicker } from "./dj-picker";
import type { SpotifyAccount } from "./spotify-account";
import { focusRing, SpotifyMark } from "./ui";
import type { DeviceStatus } from "./use-spotify-device";
import type { Dj } from "./voice-store";

/**
 * The desk: the three things to set before going on air, as one inset-grouped list in the order
 * they gate each other — the Spotify account, this tab as the player, who's on the mic. Each row
 * is leading glyph / label + detail / trailing value or control; a row whose prerequisite isn't
 * met is dimmed, so the list itself reads as the checklist.
 */
export function Desk({
  account,
  onConnect,
  onDisconnect,
  device,
  onActivate,
  dj,
  onDj,
}: {
  account: SpotifyAccount | null;
  onConnect: () => void;
  onDisconnect: () => void;
  device: DeviceStatus;
  onActivate: () => void;
  dj: Dj;
  onDj: (d: Dj) => void;
}) {
  const premium = account?.product === "premium";
  const ready = device.kind === "ready";

  return (
    <section
      aria-label="Setup"
      className="divide-y divide-zinc-800/80 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60"
    >
      <Row
        glyph={<SpotifyMark className={`size-5 ${account ? "text-[#1DB954]" : "text-zinc-600"}`} />}
        label="Spotify"
        detail={
          !account
            ? "Playback needs a Premium account"
            : premium
              ? (account.displayName ?? account.spotifyUserId)
              : `${account.displayName ?? account.spotifyUserId} — ${account.product ?? "unknown plan"}, playback needs Premium`
        }
        tone={account && !premium ? "warn" : "normal"}
      >
        {account ? (
          <button type="button" onClick={onDisconnect} className={ghostBtn}>
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            onClick={onConnect}
            className={`rounded-full bg-[#1DB954] px-3.5 py-1.5 text-sm font-semibold text-black transition hover:bg-[#1ed760] ${focusRing}`}
          >
            Connect
          </button>
        )}
      </Row>

      <Row
        glyph={
          <Radio
            className={`size-5 ${ready ? "text-[#1DB954]" : ""}`}
            strokeWidth={1.75}
            aria-hidden="true"
          />
        }
        label="Player"
        detail={
          device.kind === "error"
            ? device.message
            : ready
              ? "This tab plays the show"
              : device.kind === "connecting"
                ? "Registering this tab with Spotify…"
                : "Make this tab the Spotify device"
        }
        tone={device.kind === "error" ? "error" : "normal"}
        dim={!premium}
      >
        {!ready && (
          <button
            type="button"
            onClick={onActivate}
            disabled={!premium || device.kind === "connecting"}
            className={`rounded-full border border-zinc-700 px-3.5 py-1.5 text-sm font-medium text-zinc-100 transition hover:border-zinc-500 disabled:opacity-40 ${focusRing}`}
          >
            {device.kind === "connecting"
              ? "Activating…"
              : device.kind === "error"
                ? "Try again"
                : "Activate"}
          </button>
        )}
      </Row>

      <Row glyph={<MicGlyph />} label="On the mic" detail="Switching mid-show is a handoff on air">
        <DjPicker value={dj} onChange={onDj} />
      </Row>
    </section>
  );
}

function Row({
  glyph,
  label,
  detail,
  tone = "normal",
  dim = false,
  children,
}: {
  glyph: ReactNode;
  label: string;
  detail: string;
  tone?: "normal" | "warn" | "error";
  dim?: boolean;
  children: ReactNode;
}) {
  const detailColor =
    tone === "error" ? "text-red-400" : tone === "warn" ? "text-amber-300/90" : "text-zinc-500";
  return (
    <div
      className={`flex min-h-14 items-center gap-3 py-2.5 pr-3 pl-4 transition ${dim ? "opacity-50" : ""}`}
    >
      <span className="flex size-6 shrink-0 items-center justify-center text-zinc-400">{glyph}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-zinc-100">{label}</div>
        <div className={`truncate text-xs ${detailColor}`}>{detail}</div>
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  );
}

const ghostBtn = `rounded-full px-3 py-1.5 text-sm text-zinc-400 transition hover:text-zinc-100 ${focusRing}`;

function MicGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      aria-hidden="true"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" strokeLinecap="round" />
    </svg>
  );
}
