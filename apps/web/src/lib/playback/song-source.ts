export interface SongSource {
  url: string;
  expiresAt: number;
}

/** Per-deck URL cache. Reuse signatures across seeks; renew before a full record could outlive one. */
export class SongSources {
  private sources = new Map<string, SongSource>();

  async resolve(endpoint: string, durationMs: number, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    const cached = this.sources.get(endpoint);
    if (cached && cached.expiresAt > Date.now() + durationMs + 60_000) return cached.url;
    const response = await fetch(endpoint, { signal, cache: "no-store" });
    if (!response.ok) throw new Error(`Track playback HTTP ${response.status}`);
    const source = (await response.json()) as SongSource;
    signal.throwIfAborted();
    if (!source.url || !Number.isFinite(source.expiresAt) || source.expiresAt <= Date.now())
      throw new Error("Invalid track playback URL");
    // Only the current and upcoming records need signatures retained.
    this.sources.delete(endpoint);
    this.sources.set(endpoint, source);
    if (this.sources.size > 2) this.sources.delete(this.sources.keys().next().value!);
    return source.url;
  }
}
