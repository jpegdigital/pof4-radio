/**
 * The clips and the tracks, once per URL for the life of the page: each fetched as a blob,
 * measured, and kept as an object URL its element plays (a rewind is instant; a resumed show's
 * past slots are ready the moment they are fetched; a track pulled while the last one played
 * starts on time). The bed is decoded once into the shared graph's context. A
 * failed fetch is remembered as such and retried on the next ask.
 */

export type ClipEntry = { url: string; durationMs: number } | { error: string };

const clips = new Map<string, ClipEntry>();
const inflight = new Map<string, Promise<ClipEntry>>();

/** Fetch and measure a clip, once; a remembered failure is tried again. */
export function getClip(url: string): Promise<ClipEntry> {
  const have = clips.get(url);
  if (have && "url" in have) return Promise.resolve(have);
  const going = inflight.get(url);
  if (going) return going;
  const p = (async (): Promise<ClipEntry> => {
    let entry: ClipEntry;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`clip ${res.status}`);
      const obj = URL.createObjectURL(await res.blob());
      entry = { url: obj, durationMs: await measure(obj) };
    } catch (err) {
      entry = { error: err instanceof Error ? err.message : String(err) };
    } finally {
      inflight.delete(url);
    }
    clips.set(url, entry);
    return entry;
  })();
  inflight.set(url, p);
  return p;
}

/** Chrome reports a streamed mp3's length through `durationchange` (finite), not `loadedmetadata`. */
function measure(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const a = document.createElement("audio");
    a.preload = "auto";
    a.ondurationchange = () => {
      if (Number.isFinite(a.duration)) resolve(a.duration * 1000);
    };
    a.onerror = () => reject(new Error("could not read the clip's length"));
    a.src = url;
  });
}

const beds = new Map<string, Promise<AudioBuffer>>();

/** The bed decoded once per URL in the graph's context. */
export function getBed(ctx: AudioContext, url: string): Promise<AudioBuffer> {
  let p = beds.get(url);
  if (!p) {
    p = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`bed ${res.status}`);
        return res.arrayBuffer();
      })
      .then((buf) => ctx.decodeAudioData(buf));
    p.catch(() => beds.delete(url));
    beds.set(url, p);
  }
  return p;
}
