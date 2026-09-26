"use client";

import Link from "next/link";
import { ArrowLeft, Expand, ListMusic, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { clock } from "../../../(app)/sessions/[id]/types";
import { beatStep, newBeat, sceneSize, tempoOf } from "./rhythm";
import { BoothScene } from "./scene";
import { useShow } from "./use-show";

/**
 * The booth: the same show as the session page, played as a DJ set. The whole screen is the
 * scene (scene.ts) — the duo behind the decks, the crowd, the lasers — moving to what the
 * analyser hears; over it a thin HUD: the station, the ON AIR lamp, the record on the decks with
 * its LED progress, ⏮ ⏯ ⏭, what is up next, and while the mic is open the DJ's words crawling
 * across a ticker. The HUD steps back when the pointer rests; any touch or key brings it back.
 */

const PULSE_DECAY = 0.9;
const IDLE_MS = 4500;
const BANDS = 10;
const SEGMENTS = 40;

export function BoothView({ id }: { id: string }) {
  const show = useShow(id);
  const { state, deck, cue, prep, talking, running } = show;
  const canvas = useRef<HTMLCanvasElement>(null);
  const cover = useRef<HTMLCanvasElement>(null);
  const hud = useRef<HTMLElement>(null);
  const [awake, setAwake] = useState(true);
  const [now, setNow] = useState<Date | null>(null);

  // The frame loop reads the latest show through a ref, so it is started once.
  const live = useRef({
    running,
    talking,
    chart: cue?.chart,
    image: cue?.pick.image ?? null,
    analyser: deck.analyser,
  });
  useEffect(() => {
    live.current = {
      running,
      talking,
      chart: cue?.chart,
      image: cue?.pick.image ?? null,
      analyser: deck.analyser,
    };
  });

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const scene = new BoothScene(el);
    let beat = newBeat();
    let pulse = 0;
    let bins: Uint8Array<ArrayBuffer> | null = null;
    let coverImg: HTMLImageElement | null = null;
    let frame = 0;
    const tick = (ms: number) => {
      const l = live.current;
      if (l.image && coverImg?.dataset.src !== l.image) {
        coverImg = new Image();
        coverImg.crossOrigin = "anonymous";
        coverImg.dataset.src = l.image;
        coverImg.src = l.image;
      } else if (!l.image) coverImg = null;
      const node = l.running ? l.analyser() : null;
      let bass = 0;
      let mid = 0;
      let high = 0;
      const bands = new Array<number>(BANDS).fill(0);
      if (node) {
        if (!bins || bins.length !== node.frequencyBinCount) bins = new Uint8Array(node.frequencyBinCount);
        node.getByteFrequencyData(bins);
        const avg = (from: number, to: number) => {
          let s = 0;
          for (let i = from; i < to; i++) s += bins![i];
          return s / (to - from) / 255;
        };
        bass = avg(1, 4);
        mid = avg(4, 40);
        high = avg(40, 180);
        // Log-spaced bands for the meters.
        for (let b = 0; b < BANDS; b++) {
          const from = Math.floor(2 ** (b * 0.75 + 0.5));
          bands[b] = avg(from, Math.max(from + 1, Math.floor(2 ** ((b + 1) * 0.75 + 0.5))));
        }
      }
      const step = beatStep(beat, bass, ms);
      beat = step.state;
      pulse = step.beat ? 1 : pulse * PULSE_DECAY;
      const { width, height } = sceneSize(window.innerWidth, window.innerHeight);
      // Portrait: raise the stage clear of the deck panel (most of it; the crowd may tuck under).
      const panel = hud.current?.offsetHeight ?? 0;
      const lift = window.innerHeight > window.innerWidth ? panel * (height / window.innerHeight) * 0.8 : 0;
      scene.draw({
        nowMs: ms,
        width,
        height,
        lift,
        playing: l.running,
        talking: l.talking,
        bpm: beat.bpm ?? tempoOf(l.chart?.tempo),
        pulse,
        bass,
        mid,
        high,
        bands,
        cover: coverImg,
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  // The cover on the HUD, shrunk to 32 lamps a side and drawn back up with hard edges.
  const image = cue?.pick.image ?? null;
  useEffect(() => {
    const el = cover.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    ctx.fillStyle = "#1d0636";
    ctx.fillRect(0, 0, el.width, el.height);
    if (!image) return;
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, el.width, el.height);
    img.src = image;
  }, [image]);

  // The wall clock, once a second — mounted only, so the server render never disagrees.
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);

  // The HUD steps back while the pointer rests on a running show.
  useEffect(() => {
    let timer = 0;
    const wake = () => {
      setAwake(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setAwake(false), IDLE_MS);
    };
    wake();
    const events = ["pointermove", "pointerdown", "keydown", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, wake, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, wake);
    };
  }, []);

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const keys = useRef({ toggle: show.toggle, prev: show.prev, next: show.next, fullscreen });
  useEffect(() => {
    keys.current = { toggle: show.toggle, prev: show.prev, next: show.next, fullscreen };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest("button, a, input, textarea")) return;
      if (e.key === " " || e.key === "k") keys.current.toggle();
      else if (e.key === "ArrowLeft") keys.current.prev();
      else if (e.key === "ArrowRight") keys.current.next();
      else if (e.key === "f") keys.current.fullscreen();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const phase = deck.phase;
  const started = deck.cue !== null;
  const paused = deck.intent === "pause" || phase === "idle" || phase === "error";
  const making = phase === "loading" || !prep.ready;
  const track =
    deck.track ?? (cue ? { positionMs: 0, durationMs: cue.pick.durationMs, playing: false } : null);
  const lit =
    track && track.durationMs > 0 ? Math.round((track.positionMs / track.durationMs) * SEGMENTS) : 0;
  const produceError = state.phase === "ready" ? state.produceError : null;
  const upcoming = show.upcoming;
  const mic = deck.plan?.mic;
  const script = [cue?.legalId, cue?.words, cue?.leadLine].filter(Boolean).join("  ✦  ");
  const deckName = cue && cue.seq % 2 ? "DECK A" : "DECK B";
  const hudAwake = awake || !running || !started;

  const status = (() => {
    if (state.phase === "error") return "SIGNAL LOST";
    if (produceError) return "NEEDS A RETRY";
    if (phase === "loading") return "CUEING RECORD";
    if (deck.ended) return "DIGGING FOR THE NEXT ONE";
    if (phase === "paused") return "PAUSED";
    if (phase === "held") return "INTERRUPTED";
    if (!started) return prep.ready ? "READY" : prep.label.toUpperCase();
    return talking ? "ON THE MIC" : "IN THE MIX";
  })();

  return (
    <main className={`booth ${hudAwake ? "is-awake" : "is-resting"} ${talking ? "is-talking" : ""}`}>
      <canvas ref={canvas} className="booth-scene" aria-hidden="true" />
      <div className="booth-crt" aria-hidden="true" />

      <header className="booth-top">
        <div className="booth-brand">
          <Link href="/" aria-label="All shows" className="booth-chip">
            <ArrowLeft aria-hidden="true" />
          </Link>
          <div>
            <p className="booth-logo" data-text="CLAUDE RADIO">
              CLAUDE RADIO
            </p>
            <p className="booth-kicker">LIVE FROM THE BOOTH</p>
          </div>
        </div>
        <div className="booth-right">
          <span className={`booth-onair ${talking ? "on" : ""}`} role="status">
            ON AIR
          </span>
          <span className="booth-clock" suppressHydrationWarning>
            {now ? now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--:--"}
          </span>
          <Link
            href={`/sessions/${id}`}
            aria-label="Classic player"
            title="Classic player"
            className="booth-chip"
          >
            <ListMusic aria-hidden="true" />
          </Link>
          <button
            type="button"
            onClick={fullscreen}
            aria-label="Full screen"
            title="Full screen (F)"
            className="booth-chip"
          >
            <Expand aria-hidden="true" />
          </button>
        </div>
      </header>

      {!started && (
        <section className="booth-title" aria-label="Start the set">
          <p className="booth-request">
            {state.phase === "ready" ? `TONIGHT: “${state.session.prompt}”` : "TUNING IN…"}
          </p>
          {prep.ready ? (
            <button
              type="button"
              className="booth-start"
              onClick={show.toggle}
              disabled={phase === "loading"}
            >
              {phase === "loading" ? "CUEING…" : "PRESS START"}
            </button>
          ) : (
            <div className="booth-warmup" role="status">
              <span>{prep.busy ? "WARMING UP THE DECKS" : "THE DECKS ARE COLD"}</span>
              <div className={`booth-loader ${prep.busy ? "busy" : ""}`} aria-hidden="true">
                {Array.from({ length: 16 }, (_, i) => (
                  <i key={i} style={{ animationDelay: `${i * 70}ms` }} />
                ))}
              </div>
              <small>{prep.label}</small>
            </div>
          )}
        </section>
      )}

      {(state.phase === "error" || produceError || show.pullError || (phase === "error" && deck.message)) && (
        <section role="alert" className="booth-alert">
          <p className="booth-alert-title">
            ▲ {state.phase === "error" ? "SIGNAL LOST" : "THE NEEDLE SKIPPED"}
          </p>
          <p>
            {state.phase === "error"
              ? state.message
              : produceError
                ? produceError.message
                : show.pullError
                  ? `The record wouldn’t download: ${show.pullError}`
                  : `${deck.message} — press play to try again.`}
          </p>
          {state.phase === "error" && (
            <button type="button" onClick={() => window.location.reload()}>
              RETRY
            </button>
          )}
          {produceError && (
            <button type="button" disabled={show.retrying} onClick={show.retryProduction}>
              {show.retrying ? "RETRYING…" : "RETRY PREPARATION"}
            </button>
          )}
          {show.pullError && (
            <button type="button" onClick={show.retryPull}>
              RETRY DOWNLOAD
            </button>
          )}
        </section>
      )}

      {cue && (
        <section ref={hud} className="booth-deck" aria-label="On the decks">
          {talking && script && mic && (
            <div className="booth-ticker" aria-live="off">
              <span className="booth-ticker-tag">DJ</span>
              <div className="booth-ticker-window">
                <p
                  key={`${cue.seq}-${cue.clipKey}`}
                  style={{ animationDuration: `${Math.max(6, (mic.endMs - mic.atMs) / 1000)}s` }}
                >
                  {script}
                </p>
              </div>
            </div>
          )}
          <div className="booth-panel">
            <canvas
              ref={cover}
              width={32}
              height={32}
              className="booth-cover"
              aria-label={`${cue.pick.album} cover`}
              role="img"
            />
            <div className="booth-meta">
              <p className="booth-label">
                <span className={`booth-dot ${running ? "on" : ""}`} aria-hidden="true" />
                {deckName} · {status}
              </p>
              <h1 className="booth-track">{cue.pick.title}</h1>
              <p className="booth-artist">{cue.pick.artists.join(", ")}</p>
              <div className="booth-progress" aria-hidden="true">
                {Array.from({ length: SEGMENTS }, (_, i) => (
                  <i key={i} className={i < lit ? "on" : ""} />
                ))}
              </div>
              <p className="booth-times">
                <span>{clock(track?.positionMs ?? 0)}</span>
                <span className="booth-next">
                  {show.nextCue
                    ? `NEXT ▸ ${show.nextCue.pick.title} — ${show.nextCue.pick.artists.join(", ")}`
                    : upcoming
                      ? `NEXT ▸ ${upcoming.title} — ${upcoming.artist}`
                      : "NEXT ▸ THE DJ IS DIGGING…"}
                </span>
                <span>{clock(track?.durationMs ?? 0)}</span>
              </p>
            </div>
            <div className="booth-transport">
              <button type="button" onClick={show.prev} disabled={!show.canPrev} aria-label="Previous">
                <SkipBack aria-hidden="true" fill="currentColor" strokeWidth={0} />
              </button>
              <button
                type="button"
                className="booth-play"
                onClick={show.toggle}
                disabled={making && !started}
                aria-label={paused ? "Play" : "Pause"}
              >
                {paused ? (
                  <Play aria-hidden="true" fill="currentColor" strokeWidth={0} />
                ) : (
                  <Pause aria-hidden="true" fill="currentColor" strokeWidth={0} />
                )}
              </button>
              <button type="button" onClick={show.next} disabled={!show.nextCue} aria-label="Next">
                <SkipForward aria-hidden="true" fill="currentColor" strokeWidth={0} />
              </button>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
