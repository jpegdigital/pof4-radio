"use client";

import { type Voice, VOICE_DEFAULTS, VOICE_MODELS, type VoiceModelId } from "@radio/dj";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { guarded } from "@/lib/guard-client";
import { deleteVoice, moveVoice, saveVoice, type VoiceState } from "./actions";

/**
 * One voice of the roster: who it is (ElevenLabs id, name, grouping), which model reads it,
 * and that model's knobs — v3's stability is a three-way mode, v2's a slider. A line of sample
 * talk and "Hear it" play the form as it stands, saved or not, through /api/tts/preview.
 */

const SAMPLE_TALK =
  "That was Al Green with Simply Beautiful, cut in Memphis in seventy-two. Let's stay in that room a little longer.";

const NEW_VOICE: Voice = { id: "", name: "", gender: "male", ...VOICE_DEFAULTS };

const field =
  "w-full rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100 focus:border-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-lamp/60";

export function VoiceEditor({
  voice,
  index,
  count,
  updatedAt,
}: {
  voice: Voice | null;
  /** Position in the roster, -1 for a new voice. */
  index: number;
  count: number;
  updatedAt: string | null;
}) {
  const router = useRouter();
  const isNew = voice === null;
  const original = voice ?? NEW_VOICE;
  const [v, setV] = useState<Voice>(original);
  const [save, saveAction, saving] = useActionState<VoiceState, FormData>(saveVoice, {});
  const [moving, startMove] = useTransition();
  const [armed, setArmed] = useState(false);
  const dirty = JSON.stringify(v) !== JSON.stringify(original);
  const model = VOICE_MODELS.find((m) => m.id === v.modelId) ?? VOICE_MODELS[0];

  // A saved new voice (or a renamed id) has its own rail entry now — open it.
  useEffect(() => {
    if (save.savedAt && save.id && save.id !== original.id) {
      router.replace(`/settings?voice=${encodeURIComponent(save.id)}`);
    }
  }, [save.savedAt, save.id, original.id, router]);

  const set = <K extends keyof Voice>(k: K, val: Voice[K]) => setV((cur) => ({ ...cur, [k]: val }));

  function pickModel(id: VoiceModelId) {
    const m = VOICE_MODELS.find((x) => x.id === id)!;
    // v3 takes only its three modes: snap a slider value to the nearest.
    const stability = m.stabilities
      ? m.stabilities.reduce(
          (best, s) => (Math.abs(s.value - v.stability) < Math.abs(best - v.stability) ? s.value : best),
          0.5,
        )
      : v.stability;
    setV((cur) => ({ ...cur, modelId: id, stability }));
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-display text-sm uppercase tracking-[0.2em] text-zinc-500">
            {isNew ? "New voice" : index === 0 ? "The default voice" : `Voice ${index + 1} of ${count}`}
            {updatedAt && !isNew ? ` · roster edited ${when(updatedAt)}` : ""}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {v.name || (isNew ? "Untitled" : original.name)}
          </h1>
          <p className="mt-1 max-w-prose text-sm text-zinc-400">
            An ElevenLabs voice and how it&rsquo;s read. The listener picks it by name; the tuning is applied
            on the server to every line of talk.
          </p>
        </div>
        {!isNew && (
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span className="font-display uppercase tracking-[0.15em]">Order</span>
            <button
              type="button"
              disabled={moving || index <= 0}
              onClick={() => startMove(() => moveVoice(original.id, -1))}
              className="rounded-md border border-zinc-800 px-2 py-1 text-zinc-300 transition hover:border-zinc-600 disabled:opacity-30"
              aria-label="Move up"
            >
              ↑
            </button>
            <button
              type="button"
              disabled={moving || index >= count - 1}
              onClick={() => startMove(() => moveVoice(original.id, 1))}
              className="rounded-md border border-zinc-800 px-2 py-1 text-zinc-300 transition hover:border-zinc-600 disabled:opacity-30"
              aria-label="Move down"
            >
              ↓
            </button>
          </div>
        )}
      </div>

      <form action={saveAction} className="flex flex-col gap-6">
        <input type="hidden" name="was" value={original.id} />
        <input type="hidden" name="voice" value={JSON.stringify(v)} />

        <Section title="Who">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_9rem]">
            <label className="flex flex-col gap-1.5 text-xs text-zinc-500">
              <span className="font-display uppercase tracking-[0.15em]">Name</span>
              <input
                value={v.name}
                onChange={(e) => set("name", e.target.value)}
                className={field}
                maxLength={40}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-zinc-500">
              <span className="font-display uppercase tracking-[0.15em]">ElevenLabs voice id</span>
              <input
                value={v.id}
                onChange={(e) => set("id", e.target.value.trim())}
                className={`${field} font-mono`}
                spellCheck={false}
                maxLength={64}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-zinc-500">
              <span className="font-display uppercase tracking-[0.15em]">Grouped under</span>
              <select
                value={v.gender}
                onChange={(e) => set("gender", e.target.value as Voice["gender"])}
                className={field}
              >
                <option value="female">Female</option>
                <option value="male">Male</option>
              </select>
            </label>
          </div>
        </Section>

        <Section title="Model">
          <div className="grid gap-2 sm:grid-cols-2">
            {VOICE_MODELS.map((m) => {
              const on = m.id === v.modelId;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => pickModel(m.id)}
                  aria-pressed={on}
                  className={`rounded-md border px-4 py-3 text-left transition ${
                    on
                      ? "border-lamp/60 bg-zinc-800 text-zinc-100"
                      : "border-zinc-800 text-zinc-400 hover:border-zinc-600"
                  }`}
                >
                  <span className="block text-sm font-medium">{m.label}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-zinc-500">{m.blurb}</span>
                  <span className="mt-1 block font-mono text-[11px] text-zinc-600">{m.id}</span>
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="Delivery">
          <div className="flex flex-col gap-5">
            {model.stabilities ? (
              <div className="flex flex-col gap-1.5 text-xs text-zinc-500">
                <span className="font-display uppercase tracking-[0.15em]">Stability</span>
                <div
                  className="flex gap-1 rounded-md border border-zinc-800 p-1"
                  role="radiogroup"
                  aria-label="Stability"
                >
                  {model.stabilities.map((s) => {
                    const on = s.value === v.stability;
                    return (
                      <button
                        key={s.value}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => set("stability", s.value)}
                        className={`flex-1 rounded px-3 py-1.5 text-sm transition ${
                          on ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
                        }`}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
                <span className="text-zinc-600">
                  Creative takes the most license with the talk and its tags; Robust reads it straight.
                </span>
              </div>
            ) : (
              <Slider
                label="Stability"
                value={v.stability}
                onChange={(n) => set("stability", n)}
                hint="Low: expressive but can wander. High: even, can sound flat."
              />
            )}
            <Slider
              label="Similarity"
              value={v.similarityBoost}
              onChange={(n) => set("similarityBoost", n)}
              hint="How closely it holds to the original voice."
            />
            <Slider
              label="Style"
              value={v.style}
              onChange={(n) => set("style", n)}
              hint={
                model.stabilities
                  ? "Ignored by v3 — kept for a switch to v2."
                  : "Exaggeration; above 0.5 it degrades fast."
              }
              muted={Boolean(model.stabilities)}
            />
            <Slider
              label="Speed"
              value={v.speed}
              min={0.7}
              max={1.2}
              step={0.05}
              onChange={(n) => set("speed", n)}
              hint={
                model.stabilities
                  ? "Ignored by v3 (measured: 0.7 and 1.2 read in the same time) — pace it in the talk, or use v2."
                  : "1.0 is the voice as recorded; 1.2 is about a quarter faster."
              }
              muted={Boolean(model.stabilities)}
            />
            <label className="flex items-center gap-3 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={v.speakerBoost}
                onChange={(e) => set("speakerBoost", e.target.checked)}
                className="size-4 accent-[var(--color-lamp)]"
              />
              Speaker boost
              <span className="text-xs text-zinc-600">
                a little more of the voice&rsquo;s character, a little more latency
              </span>
            </label>
          </div>
        </Section>

        <Preview voice={v} />

        <div className="flex flex-wrap items-center gap-3 border-t border-zinc-800 pt-4">
          <button
            type="submit"
            disabled={!dirty || saving || !v.id || !v.name}
            className="rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-black transition disabled:opacity-40"
          >
            {saving ? "Saving…" : isNew ? "Add to the roster" : "Save changes"}
          </button>
          {dirty && !saving && (
            <button
              type="button"
              onClick={() => setV(original)}
              className="text-sm text-zinc-400 underline-offset-2 hover:underline"
            >
              Discard
            </button>
          )}
          {save.error && <span className="text-sm text-red-400">{save.error}</span>}
          {!dirty && save.savedAt && !save.error && (
            <span className="text-sm text-zinc-500">Saved — applies to the next line of talk.</span>
          )}
          {!isNew && (
            <span className="ml-auto flex items-center gap-2">
              {armed && (
                <button
                  type="button"
                  disabled={moving}
                  onClick={() =>
                    startMove(async () => {
                      await deleteVoice(original.id);
                      router.replace("/settings?voice=new");
                    })
                  }
                  className="rounded-md bg-red-500/90 px-3 py-1.5 text-sm font-medium text-black transition hover:bg-red-400"
                >
                  Yes, remove {original.name}
                </button>
              )}
              <button
                type="button"
                onClick={() => setArmed((a) => !a)}
                className="text-sm text-zinc-500 underline-offset-2 hover:text-red-400 hover:underline"
              >
                {armed ? "Keep it" : "Remove from the roster"}
              </button>
            </span>
          )}
        </div>
      </form>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-sm uppercase tracking-[0.2em] text-zinc-500">{title}</h2>
      {children}
    </section>
  );
}

function Slider({
  label,
  value,
  onChange,
  hint,
  min = 0,
  max = 1,
  step = 0.05,
  muted = false,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  hint: string;
  min?: number;
  max?: number;
  step?: number;
  muted?: boolean;
}) {
  return (
    <label className={`flex flex-col gap-1.5 text-xs text-zinc-500 ${muted ? "opacity-50" : ""}`}>
      <span className="flex items-baseline justify-between">
        <span className="font-display uppercase tracking-[0.15em]">{label}</span>
        <span className="font-mono text-zinc-300">{value.toFixed(2)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--color-lamp)]"
      />
      <span className="text-zinc-600">{hint}</span>
    </label>
  );
}

/** A line of sample talk in the voice as the form holds it. */
function Preview({ voice }: { voice: Voice }) {
  const [text, setText] = useState(SAMPLE_TALK);
  const [status, setStatus] = useState<
    { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string }
  >({ kind: "idle" });
  const audio = useRef<HTMLAudioElement>(null);
  const url = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (url.current) URL.revokeObjectURL(url.current);
    },
    [],
  );

  async function hear() {
    setStatus({ kind: "loading" });
    try {
      const res = await guarded("/api/tts/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `preview ${res.status}`);
      }
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = URL.createObjectURL(await res.blob());
      const el = audio.current;
      if (el) {
        el.src = url.current;
        await el.play();
      }
      setStatus({ kind: "idle" });
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <Section title="Hear it · as the form stands, saved or not">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={1000}
        spellCheck={false}
        aria-label="Sample talk"
        className={`${field} resize-y font-mono text-[13px] leading-relaxed`}
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void hear()}
          disabled={status.kind === "loading" || !voice.id || !text.trim()}
          className="rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-100 transition hover:border-zinc-500 disabled:opacity-40"
        >
          {status.kind === "loading" ? "Voicing…" : "▶ Hear it"}
        </button>
        {/* biome-ignore lint/a11y/useMediaCaption: a generated voice clip, no captions to give */}
        <audio ref={audio} controls className="h-8 max-w-xs flex-1" />
        {status.kind === "error" && <span className="text-sm text-red-400">{status.message}</span>}
        {voice.modelId === "eleven_v3" && (
          <span className="basis-full text-xs text-zinc-600">
            v3 reads tags in the talk: [laughs], [whispers], [sighs], [excited], [pause]. Try one.
          </span>
        )}
      </div>
    </Section>
  );
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
