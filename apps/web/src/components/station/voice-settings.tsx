import { useEffect, useState } from "react";
import { ttsUrl, VOICE_MODELS, type VoiceSettings } from "./voice-store";

interface Voice {
  voiceId: string;
  name: string;
  category: string;
}

const PREVIEW_LINE =
  "It's late, the lights are low, and you're listening to Radio. Here's something to settle in with.";

/** The DJ's voice, chosen here and remembered in this browser. Applies to the next talk generated. */
export function VoiceSettingsPanel({
  value,
  onChange,
}: {
  value: VoiceSettings;
  onChange: (v: VoiceSettings) => void;
}) {
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<HTMLAudioElement | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/tts/voices")
      .then(async (r) => {
        if (!r.ok) throw new Error(((await r.json()) as { error?: string }).error ?? `voices ${r.status}`);
        return (await r.json()) as Voice[];
      })
      .then((v) => live && setVoices(v))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => () => preview?.pause(), [preview]);

  const set = (patch: Partial<VoiceSettings>) => onChange({ ...value, ...patch });
  const isV3 = value.modelId === "eleven_v3";

  function playPreview() {
    preview?.pause();
    const el = new Audio(ttsUrl(PREVIEW_LINE, value));
    el.onerror = () => setError("preview failed — check the voice and the ElevenLabs key");
    setPreview(el);
    void el.play();
  }

  return (
    <div className="grid gap-3 text-sm sm:grid-cols-2">
      <label className="flex flex-col gap-1">
        <span className="text-zinc-400">Voice</span>
        <select
          value={value.voiceId}
          onChange={(e) => set({ voiceId: e.target.value })}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5"
        >
          <option value="">{voices ? "choose a voice…" : "loading voices…"}</option>
          {voices?.map((v) => (
            <option key={v.voiceId} value={v.voiceId}>
              {v.name}
              {v.category ? ` · ${v.category}` : ""}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-zinc-400">Model</span>
        <select
          value={value.modelId}
          onChange={(e) =>
            set({
              modelId: e.target.value,
              stability: e.target.value === "eleven_v3" ? 0.5 : value.stability,
            })
          }
          className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5"
        >
          {VOICE_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-zinc-400">Stability {isV3 ? "" : `· ${value.stability.toFixed(2)}`}</span>
        {isV3 ? (
          <select
            value={String(value.stability)}
            onChange={(e) => set({ stability: Number(e.target.value) })}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5"
          >
            <option value="0">Creative</option>
            <option value="0.5">Natural</option>
            <option value="1">Robust</option>
          </select>
        ) : (
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={value.stability}
            onChange={(e) => set({ stability: Number(e.target.value) })}
          />
        )}
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-zinc-400">Similarity · {value.similarityBoost.toFixed(2)}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={value.similarityBoost}
          onChange={(e) => set({ similarityBoost: Number(e.target.value) })}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-zinc-400">Style · {value.style.toFixed(2)}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={value.style}
          onChange={(e) => set({ style: Number(e.target.value) })}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-zinc-400">Speed · {value.speed.toFixed(2)}</span>
        <input
          type="range"
          min={0.7}
          max={1.2}
          step={0.05}
          value={value.speed}
          onChange={(e) => set({ speed: Number(e.target.value) })}
        />
      </label>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={value.speakerBoost}
          onChange={(e) => set({ speakerBoost: e.target.checked })}
        />
        <span className="text-zinc-400">Speaker boost</span>
      </label>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={playPreview}
          disabled={!value.voiceId}
          className="rounded-md bg-zinc-100 px-3 py-1.5 font-medium text-black disabled:opacity-40"
        >
          Preview
        </button>
        {error && <span className="text-red-400">{error}</span>}
      </div>
    </div>
  );
}
