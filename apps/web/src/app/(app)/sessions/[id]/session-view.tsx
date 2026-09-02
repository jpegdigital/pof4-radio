"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ACCOUNT_KEY,
  beginLogin,
  clearAccount,
  identityOf,
  type SpotifyAccount,
} from "@/components/station/spotify-account";
import { Card, focusRing, Label, SpotifyMark } from "@/components/station/ui";
import { useSpotifyDevice } from "@/components/station/use-spotify-device";
import { RETURN_KEY } from "../../spotify/callback/spotify-callback";
import { Player } from "./player";
import { Rundown } from "./rundown";
import { onMic, prevTarget, RESTART_AFTER_MS } from "./transport";
import { type Cue, cueKey, KIND_LABEL, type Segment, type SessionDoc, type Slot } from "./types";
import { useDeck } from "./use-deck";

/**
 * A session's home, on one page: the desk (the lamp, who is connected, the request), the player,
 * the show. The browser is the whole state machine. Production: GET the snapshot, look at the
 * frontier — the last segment and its status — and POST the one rung it asks for; the response
 * is the product, no polling. open → playlist, playlisted → program, and the machine stops: the
 * slots are on the page. Each rung is attempted once per page life (a failure stays on screen,
 * a reload retries); a 409 means another producer holds the session.
 *
 * Playback: the deck (use-deck.ts) holds one cue. The transport starts and stops it; ⏮ ⏭ and a
 * tap on a row pick which slot; when the record ends the next slot goes in on its own. A cue's
 * clip is made the first time it is played, and can be voiced again from its row — the same
 * words read with the roster as it stands now; if that cue is in the deck the new take plays at
 * once. One tap does it all even when this tab isn't the Spotify device yet: the tap registers
 * the tab and the cue runs the moment the device is ready.
 */

type State =
  | { phase: "loading" }
  | { phase: "ready"; session: SessionDoc; producing: string | null; produceError: string | null }
  | { phase: "error"; message: string };

/** The one next call the frontier asks for, or null when the machine stops here. */
function nextRung(seg: Segment): { key: string; label: string; path: string; body: unknown } | null {
  if (seg.status === "open")
    return { key: `${seg.num}:playlist`, label: "composing…", path: "playlist", body: {} };
  if (seg.status === "playlisted") {
    const now = new Date();
    const clockMs = now.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return { key: `${seg.num}:program`, label: "writing…", path: "program", body: { clockMs } };
  }
  return null;
}

const noSubscribe = () => () => {};
const NO_SEGMENTS: Segment[] = [];

export function SessionView({ id, clientId }: { id: string; clientId: string }) {
  const [state, setState] = useState<State>({ phase: "loading" });
  const attempted = useRef(new Set<string>());
  // Who is connected to Spotify: localStorage, read so the server and the first client render agree (null), then the account.
  const rawAccount = useSyncExternalStore(
    noSubscribe,
    () => localStorage.getItem(ACCOUNT_KEY),
    () => null,
  );
  const [signedOut, setSignedOut] = useState(false);
  const who = useMemo(
    () => (rawAccount && !signedOut ? identityOf(JSON.parse(rawAccount) as SpotifyAccount) : null),
    [rawAccount, signedOut],
  );
  const premium = who?.product === "premium";
  const [lost, setLost] = useState<string | null>(null);
  const ended = useRef<() => void>(() => {});
  const device = useSpotifyDevice(clientId, {
    onTrackListEnded: () => ended.current(),
    onTrackChanged: () => {},
    onLost: setLost,
  });

  const load = useCallback(async (): Promise<SessionDoc> => {
    const res = await fetch(`/api/sessions/${id}`);
    const data = (await res.json().catch(() => null)) as SessionDoc | { error?: string } | null;
    if (!res.ok || !data || !("sessionId" in data)) {
      const message =
        data && "error" in data && typeof data.error === "string" ? data.error : `HTTP ${res.status}`;
      throw new Error(message);
    }
    return data;
  }, [id]);

  useEffect(() => {
    let stale = false;
    load()
      .then((session) => {
        if (!stale) setState({ phase: "ready", session, producing: null, produceError: null });
      })
      .catch((err) => {
        if (!stale) setState({ phase: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      stale = true;
    };
  }, [load]);

  // The machine's one move: the frontier segment gets the rung it asks for, once per page life.
  useEffect(() => {
    if (state.phase !== "ready" || state.producing !== null) return;
    const last = state.session.segments.at(-1);
    if (!last) return;
    const rung = nextRung(last);
    if (!rung || attempted.current.has(rung.key)) return;
    attempted.current.add(rung.key);
    setState({ ...state, producing: rung.key, produceError: null });
    (async () => {
      const res = await fetch(`/api/sessions/${id}/segments/${last.num}/${rung.path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(rung.body),
      });
      const err = res.ok
        ? null
        : (((await res.json().catch(() => null)) as { error?: string } | null)?.error ??
          `HTTP ${res.status}`);
      const session = await load();
      setState({ phase: "ready", session, producing: null, produceError: err });
    })().catch((err) => {
      setState({ phase: "error", message: err instanceof Error ? err.message : String(err) });
    });
  }, [state, id, load]);

  /** A slot came back from the audio rung: fold it into the document in place. */
  const onSlot = useCallback((num: number, slot: Slot) => {
    setState((s) => {
      if (s.phase !== "ready") return s;
      const segments = s.session.segments.map((g) =>
        g.num === num ? { ...g, slots: g.slots.map((x) => (x.seq === slot.seq ? slot : x)) } : g,
      );
      return { ...s, session: { ...s.session, segments } };
    });
  }, []);

  const deck = useDeck({ sessionId: id, device, onSlot });

  // Another take of a slot's clip: POST again, fold the row in, and hear it if it is the cue in the deck.
  const [retake, setRetake] = useState<{ key: string; error: string | null } | null>(null);
  const revoice = (c: Cue) => {
    const key = cueKey(c);
    const inDeck = deck.cue !== null && cueKey(deck.cue) === key && device.status.kind === "ready";
    setRetake({ key, error: null });
    (async () => {
      const res = await fetch(`/api/sessions/${id}/segments/${c.num}/slots/${c.slot.seq}/audio`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ again: true }),
      });
      const data = (await res.json().catch(() => null)) as Slot | { error?: string } | null;
      if (!res.ok || !data || !("seq" in data))
        throw new Error(data && "error" in data && data.error ? data.error : `HTTP ${res.status}`);
      onSlot(c.num, data);
      setRetake(null);
      if (inDeck) deck.load({ ...c, slot: data });
    })().catch((err: unknown) => {
      setRetake({ key, error: err instanceof Error ? err.message : String(err) });
    });
  };

  // Every slot with its record, in show order; the deck's cue or the first of them is what the player shows.
  const segments = state.phase === "ready" ? state.session.segments : NO_SEGMENTS;
  const cues = useMemo<Cue[]>(
    () =>
      segments.flatMap((g) =>
        g.slots.flatMap((slot) => {
          const track = g.tracks.find((t) => t.id === slot.trackId);
          return track ? [{ num: g.num, slot, track }] : [];
        }),
      ),
    [segments],
  );
  const cue = deck.cue ?? cues[0] ?? null;
  const index = cue ? cues.findIndex((c) => cueKey(c) === cueKey(cue)) : -1;
  const ready = device.status.kind === "ready";
  const arming = device.status.kind === "connecting";

  // One tap even when this tab isn't the device yet: register, then load when ready.
  // The unlock/activate calls must stay inside the tap.
  const armed = useRef<Cue | null>(null);
  const go = (c: Cue) => {
    deck.unlock();
    device.activate();
    if (ready) {
      deck.load(c);
      return;
    }
    armed.current = c;
    void device.connect();
  };
  const deckLoad = deck.load;
  useEffect(() => {
    const c = armed.current;
    if (!c) return;
    if (ready) {
      armed.current = null;
      deckLoad(c);
    } else if (device.status.kind === "error") {
      armed.current = null;
    }
  }, [ready, device.status.kind, deckLoad]);

  const toggle = () => {
    deck.unlock();
    device.activate();
    if (deck.cue && ready) deck.toggle();
    else if (cue) go(cue);
  };
  const prev = () => {
    const target = cues[prevTarget(index, deck.headMs)];
    if (target) go(target);
  };
  const next = () => {
    const target = cues[index + 1];
    if (target) go(target);
  };
  // The record ended on its own: the next slot goes in.
  useEffect(() => {
    ended.current = () => {
      const target = cues[index + 1];
      if (deck.phase === "playing" && target) deckLoad(target);
    };
  });

  const running = deck.phase === "playing";
  const talking = running && deck.plan !== null && onMic(deck.plan, deck.headMs);
  const status = (() => {
    if (deck.phase === "voicing") return "Voicing the slot…";
    if (deck.phase === "loading") return "Loading the voice…";
    if (deck.phase === "paused") return "Paused";
    if (deck.phase === "error") return "Stopped";
    if (!running || !deck.cue) return "Off air";
    const seg = segments.find((g) => g.num === deck.cue?.num);
    const n = seg ? seg.slots.findIndex((s) => s.seq === deck.cue?.slot.seq) + 1 : 0;
    return `${KIND_LABEL[deck.cue.slot.kind]} · slot ${n} of ${seg?.slots.length ?? 0}`;
  })();

  const connect = () => {
    sessionStorage.setItem(RETURN_KEY, location.pathname);
    void beginLogin(clientId);
  };
  const signOut = () => {
    clearAccount();
    setSignedOut(true);
  };

  const producing = (() => {
    if (state.phase !== "ready" || !state.producing) return null;
    const [num, path] = state.producing.split(":");
    return { num: Number(num), label: path === "playlist" ? "composing…" : "writing…" };
  })();

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pt-5 pb-10">
      <h1 className="font-display text-2xl font-semibold uppercase tracking-[0.18em]">
        <Link href="/" className={`rounded-sm transition hover:text-lamp ${focusRing}`}>
          Claude Radio
        </Link>
      </h1>

      {/* the desk: the lamp and who's connected; the request under it */}
      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className={`lamp size-2.5 rounded-full ${running ? "on" : ""} ${talking ? "talking" : ""}`}
            />
            <Label className={running ? "text-lamp" : ""}>{running ? "On air" : "Off air"}</Label>
          </div>
          {who ? (
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <SpotifyMark className="size-4 shrink-0 text-[#1DB954]" />
              <span className="truncate text-zinc-300">{who.displayName ?? who.spotifyUserId}</span>
              {!premium && <span className="shrink-0 text-xs text-amber-300/90">not Premium</span>}
              <button
                type="button"
                onClick={signOut}
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
              onClick={connect}
              className={`flex items-center gap-2 rounded-full bg-[#1DB954] px-3.5 py-1.5 text-xs font-semibold text-black transition hover:bg-[#1ed760] ${focusRing}`}
            >
              <SpotifyMark className="size-3.5" />
              Connect
            </button>
          )}
        </div>
        {state.phase === "ready" && (
          <p className="font-mono text-sm leading-relaxed text-zinc-300">{state.session.prompt}</p>
        )}
        {!who && <p className="text-xs text-zinc-500">Playback needs a Spotify Premium account.</p>}
        {arming && <p className="text-xs text-zinc-500">Making this tab the player…</p>}
        {device.status.kind === "error" && (
          <p className="text-xs text-red-400">
            This tab couldn&rsquo;t become the player: {device.status.message}
          </p>
        )}
        {lost && <p className="text-xs text-red-400">{lost}</p>}
      </Card>

      {state.phase === "loading" && <p className="text-sm text-zinc-500">Loading the session…</p>}
      {state.phase === "error" && (
        <p className="rounded-xl border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
          {state.message}
        </p>
      )}
      {state.phase === "ready" && state.produceError && (
        <p className="rounded-xl border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
          {state.produceError}
        </p>
      )}
      {retake?.error && (
        <p className="rounded-xl border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
          Couldn&rsquo;t voice it again: {retake.error}. The slot keeps its last take.
        </p>
      )}
      {deck.phase === "error" && deck.message && (
        <p className="rounded-xl border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
          {deck.message} — press play to try the slot again.
        </p>
      )}

      {/* the player: mounted from the first slot on, never unmounts */}
      {cue && (
        <Card className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <Label>Now playing</Label>
            <span className={`text-xs ${running ? "text-zinc-300" : "text-zinc-500"}`}>{status}</span>
          </div>
          <Player
            cue={cue}
            phase={deck.phase}
            plan={deck.plan}
            headMs={deck.headMs}
            playback={device.playback}
            canPrev={premium && (index > 0 || deck.headMs > RESTART_AFTER_MS)}
            canNext={premium && index >= 0 && index < cues.length - 1}
            onPrev={prev}
            onNext={next}
            onToggle={toggle}
            onScrub={deck.seek}
            onSeekRecord={(ms) => void device.seek(ms).catch(() => {})}
          />
          {who && !premium && (
            <p className="text-xs text-zinc-500">Only a Premium account can be the player.</p>
          )}
        </Card>
      )}

      {state.phase === "ready" && (
        <Rundown
          segments={segments}
          producing={producing}
          cursor={deck.cue ? cueKey(deck.cue) : null}
          retaking={retake && !retake.error ? retake.key : null}
          onPick={(c) => {
            if (premium) go(c);
          }}
          onRetake={revoice}
        />
      )}
    </div>
  );
}
