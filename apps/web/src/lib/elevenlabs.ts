import { withoutAudioTags, type Voice } from "./voices.ts";

/**
 * ElevenLabs, the station's voice: a line of talk in a roster voice becomes MP3. One POST for
 * every take the show asks of it — `speak` for the whole clip the rung keeps, `speakStream` for
 * the control room's "hear it", piped through as it arrives. What is said and where the audio
 * goes stay with the caller; this file owns the wire: the endpoint, the format, the body a voice
 * makes, the timeout and the error. No retries: a failed take stops the voicing and the script
 * is kept. The key is handed in, never read from env here.
 */

const TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech";
/** What every clip in the bucket is, and what the browser's deck expects. */
const OUTPUT_FORMAT = "mp3_44100_128";
const TTS_TIMEOUT_MS = 30_000;
const ERROR_BODY_MAX = 200;

/** A take that could not be made. `status` is the HTTP status, or null when the call never landed. */
export class ElevenLabsError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null, options?: ErrorOptions) {
    super(message, options);
    this.name = "ElevenLabsError";
    this.status = status;
  }
}

/** The text-to-speech request body for one line of talk in this voice. */
export function ttsBody(voice: Voice, text: string) {
  return {
    text: voice.modelId === "eleven_v3" ? text : withoutAudioTags(text),
    model_id: voice.modelId,
    voice_settings: {
      stability: voice.stability,
      similarity_boost: voice.similarityBoost,
      style: voice.style,
      speed: voice.speed,
      use_speaker_boost: voice.speakerBoost,
    },
  };
}

/** The exact body sent, retained with each take so a voicing can be inspected and replayed. */
export type TtsRequest = ReturnType<typeof ttsBody>;

export interface SpeakCall {
  apiKey: string;
  /** A long read may be given longer than the default. Covers the body too, streamed or not. */
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

/** One POST, timed. `path` is "" for the whole take or "/stream"; the answer comes back unread. */
async function post(path: "" | "/stream", voice: Voice, text: string, call: SpeakCall) {
  const request = ttsBody(voice, text);
  let res: Response;
  try {
    res = await (call.fetchFn ?? fetch)(
      `${TTS_URL}/${encodeURIComponent(voice.id)}${path}?output_format=${OUTPUT_FORMAT}`,
      {
        method: "POST",
        headers: { "xi-api-key": call.apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(call.timeoutMs ?? TTS_TIMEOUT_MS),
        cache: "no-store",
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ElevenLabsError(`ElevenLabs did not answer: ${message}`, null, { cause: err });
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, ERROR_BODY_MAX);
    throw new ElevenLabsError(`ElevenLabs failed (HTTP ${res.status}): ${body}`, res.status);
  }
  return { request, res };
}

/** The whole take: the bytes, and the request that made them for the receipt. */
export async function speak(
  voice: Voice,
  text: string,
  call: SpeakCall,
): Promise<{ request: TtsRequest; bytes: Uint8Array; elapsedMs: number }> {
  const started = Date.now();
  const { request, res } = await post("", voice, text, call);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { request, bytes, elapsedMs: Date.now() - started };
}

/** The same take as it is made, for piping straight through. Nothing is kept. */
export async function speakStream(
  voice: Voice,
  text: string,
  call: SpeakCall,
): Promise<ReadableStream<Uint8Array>> {
  const { res } = await post("/stream", voice, text, call);
  if (!res.body) throw new ElevenLabsError("ElevenLabs answered with no audio", res.status);
  return res.body;
}
