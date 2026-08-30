"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A listening bench for imaging: sweepers (voice) and SFX, each playable alone, and any pair
 * played together — the SFX under the voice, the voice starting `delay` ms in. Files come from
 * scripts/sweepers-prep.mjs into /program/sweepers.
 */

interface Manifest {
  sweepers: Record<string, string>;
  sfx: Record<string, string>;
}
const url = (name: string) => `/program/sweepers/${name}.mp3`;

export default function Sweepers() {
  const [m, setM] = useState<Manifest | null>(null);
  const [sweep, setSweep] = useState<string | null>(null);
  const [fx, setFx] = useState<string | null>(null);
  const [delay, setDelay] = useState(300);
  const [fxLevel, setFxLevel] = useState(0.6);
  const players = useRef<HTMLAudioElement[]>([]);

  useEffect(() => {
    void fetch("/program/sweepers/manifest.json")
      .then((r) => r.json())
      .then((j: Manifest) => {
        setM(j);
        setSweep(Object.keys(j.sweepers)[0] ?? null);
        setFx(Object.keys(j.sfx)[0] ?? null);
      });
  }, []);

  const stopAll = () => {
    for (const a of players.current) a.pause();
    players.current = [];
  };
  const play = (name: string, volume = 1, at = 0) => {
    const a = new Audio(url(name));
    a.volume = volume;
    players.current.push(a);
    setTimeout(() => void a.play().catch(() => {}), at);
  };
  const combined = () => {
    stopAll();
    if (fx) play(fx, fxLevel);
    if (sweep) play(sweep, 1, delay);
  };

  if (!m) return <p className="p-6 text-zinc-500">loading…</p>;

  return (
    <main className="mx-auto max-w-xl space-y-8 p-6">
      <h1 className="font-display text-2xl">Sweepers</h1>

      <Section title="Voice">
        {Object.entries(m.sweepers).map(([name, text]) => (
          <Row key={name} name={name} text={text} picked={sweep === name} onPick={() => setSweep(name)} />
        ))}
      </Section>

      <Section title="SFX">
        {Object.entries(m.sfx).map(([name, text]) => (
          <Row key={name} name={name} text={text} picked={fx === name} onPick={() => setFx(name)} />
        ))}
      </Section>

      <Section title="Together">
        <p className="text-sm text-zinc-400">
          {fx ?? "—"} under {sweep ?? "—"}
        </p>
        <label className="flex items-center gap-3 text-sm">
          <span className="w-28 text-zinc-500">voice in after</span>
          <input
            type="range"
            min={0}
            max={2000}
            step={50}
            value={delay}
            onChange={(e) => setDelay(Number(e.target.value))}
            className="flex-1"
          />
          <span className="w-16 font-mono text-xs">{delay} ms</span>
        </label>
        <label className="flex items-center gap-3 text-sm">
          <span className="w-28 text-zinc-500">sfx level</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={fxLevel}
            onChange={(e) => setFxLevel(Number(e.target.value))}
            className="flex-1"
          />
          <span className="w-16 font-mono text-xs">{fxLevel.toFixed(2)}</span>
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={combined}
            className="rounded-lg bg-lamp px-4 py-2 font-medium text-black"
          >
            Play together
          </button>
          <button type="button" onClick={stopAll} className="rounded-lg border border-zinc-700 px-4 py-2">
            Stop
          </button>
        </div>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="font-mono text-xs uppercase text-zinc-500">{title}</h2>
      {children}
    </section>
  );
}

function Row({
  name,
  text,
  picked,
  onPick,
}: {
  name: string;
  text: string;
  picked: boolean;
  onPick: () => void;
}) {
  return (
    <div className={`rounded-xl border p-3 ${picked ? "border-lamp/60 bg-zinc-900" : "border-zinc-800"}`}>
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={onPick} className="text-left font-medium hover:text-lamp">
          {name}
        </button>
        {/* biome-ignore lint/a11y/useMediaCaption: a sound bench */}
        <audio controls preload="metadata" src={url(name)} className="h-8" />
      </div>
      <p className="mt-1 text-sm text-zinc-400">{text}</p>
    </div>
  );
}
