import { createHash } from "node:crypto";

/**
 * The server's Qobuz calls, plain fetch: search the catalog and pull a record as MP3 320. There is
 * no developer API — this is the web player's own interface, reached with the listener's user auth
 * token (`localuser.token` in play.qobuz.com's localStorage, set as QOBUZ_TOKEN) and the app id +
 * secret the web player ships in its bundle.js. Those are read from the env when set (QOBUZ_APP_ID,
 * QOBUZ_SECRET) and otherwise scraped from the bundle, checked against a known track, and kept for
 * the process — the scrape is ~13 s, the check ~1 s, every call after that under a second. Ported
 * from Sei969/qobuz-dl (qopy.py + bundle.py), the MP3 path only: FLAC needs the segmented,
 * AES-keyed session flow and is not ours.
 */

const API = "https://www.qobuz.com/api.json/0.2";
const PLAYER = "https://play.qobuz.com";
/** The web player's default app id: the value that means "scrape the current one". */
export const DEFAULT_APP_ID = "798273057";
/** MP3 320. 6 / 7 / 27 are the FLAC tiers. */
export const MP3 = 5;
/** A track that has always existed; the secret check signs a getFileUrl for it. */
const CHECK_TRACK = "5966783";

/** The web player's request headers; Qobuz's edge filters what does not look like the player. */
const PLAYER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "X-App-Language": "en",
  "X-App-Region": "US",
  "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-site",
};

/** Plain fields, not parameter properties: `node scripts/qobuz-smoke.mts` strips types and runs this file as is. */
export class QobuzError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "QobuzError";
    this.status = status;
    this.body = body;
  }
}

// ---- the bundle, pure -------------------------------------------------------------------------

const BUNDLE_URL = /<script src="(\/resources\/\d+\.\d+\.\d+-[a-z]\d{3}\/bundle\.js)"><\/script>/;
const APP_ID = /production:\{api:\{appId:"(\d{9})",appSecret:"\w{32}"/;
const SEED = /[a-z]\.initialSeed\("([\w=]+)",window\.utimezone\.([a-z]+)\)/g;
const infoExtras = (tz: string) =>
  new RegExp(`name:"\\w+/${tz[0].toUpperCase()}${tz.slice(1)}",info:"([\\w=]+)",extras:"([\\w=]+)"`);
/** The bundle appends this many junk characters to each base64 secret. */
const SECRET_TAIL = 44;

/**
 * The app id and the candidate secrets out of the web player's bundle.js. Each secret is
 * base64(seed + info + extras) less a fixed tail, one per timezone the player names; which one
 * the API accepts is settled by `check`, so bundle order is kept as is.
 */
export function parseBundle(js: string): { appId: string; secrets: string[] } {
  const appId = APP_ID.exec(js)?.[1];
  if (!appId) throw new Error("qobuz bundle: no app id");
  const secrets: string[] = [];
  for (const m of js.matchAll(SEED)) {
    const [, seed, tz] = m;
    const ie = infoExtras(tz).exec(js);
    if (!ie) continue;
    const whole = seed + ie[1] + ie[2];
    secrets.push(Buffer.from(whole.slice(0, -SECRET_TAIL), "base64").toString("utf8"));
  }
  if (secrets.length === 0) throw new Error("qobuz bundle: no secret");
  return { appId, secrets };
}

/** The signature `track/getFileUrl` wants: md5 over the sorted params, the clock and the secret. */
export function fileUrlSig(trackId: string, formatId: number, ts: number, secret: string): string {
  return createHash("md5")
    .update(`trackgetFileUrlformat_id${formatId}intentstreamtrack_id${trackId}${ts}${secret}`)
    .digest("hex");
}

// ---- the track, pure --------------------------------------------------------------------------

/** The slice of a Qobuz track the playlist keeps. */
export interface Track {
  id: string;
  /** Title with the version folded in: "Dreams (2001 Remaster)". */
  title: string;
  /** The performer, then the album artist when it is someone else. */
  artists: string[];
  album: string;
  /** Album art, the large one. */
  image: string | null;
  durationMs: number;
  /** False for records the subscription cannot play (region, label); never pick these. */
  streamable: boolean;
}

export interface RawTrack {
  id: number;
  title: string;
  version?: string | null;
  duration: number;
  streamable: boolean;
  performer?: { name: string } | null;
  album: {
    title: string;
    artist?: { name: string } | null;
    image?: { small?: string; thumbnail?: string; large?: string } | null;
  };
}

export function toTrack(t: RawTrack): Track {
  const performer = t.performer?.name;
  const albumArtist = t.album.artist?.name;
  const artists = [performer, albumArtist].filter((a, i, all): a is string => !!a && all.indexOf(a) === i);
  const version = t.version?.trim();
  return {
    id: String(t.id),
    title: version ? `${t.title} (${version})` : t.title,
    artists,
    album: t.album.title,
    image: t.album.image?.large ?? t.album.image?.small ?? null,
    durationMs: t.duration * 1000,
    streamable: t.streamable,
  };
}

// ---- the client ---------------------------------------------------------------------------------

export interface QobuzConfig {
  /** The user auth token; every call carries it — even search is 401 without one now. */
  token: string;
  /** Skip the scrape when both are set and the secret still checks out. */
  appId?: string;
  secret?: string;
}

interface App {
  appId: string;
  secret: string;
}

export interface FileUrl {
  url: string;
  mimeType: string;
  formatId: number;
  /** kHz. */
  samplingRate: number;
}

export interface Me {
  id: number;
  displayName: string;
  /** The subscription's short label: "Studio", "Sublime"… */
  plan: string;
}

const g = globalThis as unknown as { __qobuzApp?: Promise<App> };

/** One client per config; the app id + secret are resolved once per process and shared. */
export function qobuz(cfg: QobuzConfig) {
  async function call<T>(path: string, params: Record<string, string>, app: App): Promise<T> {
    const url = new URL(`${API}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url, {
      headers: { ...PLAYER_HEADERS, "X-App-Id": app.appId, "X-User-Auth-Token": cfg.token },
    });
    const body = await res.text();
    if (!res.ok) throw new QobuzError(`qobuz ${path} failed (${res.status})`, res.status, body);
    return JSON.parse(body) as T;
  }

  /** getFileUrl signed with `secret`; a wrong secret is a 400 with "Invalid Request Signature". */
  async function fileUrlWith(trackId: string, app: App): Promise<FileUrl> {
    const ts = Math.floor(Date.now() / 1000);
    const r = await call<{ url: string; mime_type: string; format_id: number; sampling_rate: number }>(
      "track/getFileUrl",
      {
        track_id: trackId,
        format_id: String(MP3),
        intent: "stream",
        request_ts: String(ts),
        request_sig: fileUrlSig(trackId, MP3, ts, app.secret),
      },
      app,
    );
    return { url: r.url, mimeType: r.mime_type, formatId: r.format_id, samplingRate: r.sampling_rate };
  }

  /** The env's pair if it still signs, else the bundle's first secret that does. */
  async function resolveApp(): Promise<App> {
    if (cfg.appId && cfg.secret) {
      const given = { appId: cfg.appId, secret: cfg.secret };
      try {
        await fileUrlWith(CHECK_TRACK, given);
        return given;
      } catch (e) {
        if (!(e instanceof QobuzError) || e.status !== 400) throw e;
        console.warn("[qobuz] QOBUZ_SECRET no longer signs; scraping the bundle");
      }
    }
    const page = await fetch(`${PLAYER}/login`, { headers: PLAYER_HEADERS });
    if (!page.ok) throw new QobuzError(`qobuz login page failed (${page.status})`, page.status, "");
    const path = BUNDLE_URL.exec(await page.text())?.[1];
    if (!path) throw new Error("qobuz login page: no bundle.js");
    const js = await fetch(`${PLAYER}${path}`, { headers: PLAYER_HEADERS });
    if (!js.ok) throw new QobuzError(`qobuz bundle failed (${js.status})`, js.status, "");
    const { appId, secrets } = parseBundle(await js.text());
    for (const secret of secrets) {
      try {
        await fileUrlWith(CHECK_TRACK, { appId, secret });
        return { appId, secret };
      } catch (e) {
        if (!(e instanceof QobuzError) || e.status !== 400) throw e;
      }
    }
    throw new Error(`qobuz bundle: none of ${secrets.length} secrets signs for app ${appId}`);
  }

  function app(): Promise<App> {
    g.__qobuzApp ??= resolveApp().catch((e) => {
      g.__qobuzApp = undefined; // a failed resolve is not kept; the next call tries again
      throw e;
    });
    return g.__qobuzApp;
  }

  return {
    /** Which app id + secret are in use — for the smoke and the logs. */
    app,

    /** Who the token is: proves the token before anything else. */
    async me(): Promise<Me> {
      const r = await call<{
        id: number;
        display_name?: string;
        login?: string;
        credential?: { parameters?: { short_label?: string } | null };
      }>("user/get", {}, await app());
      return {
        id: r.id,
        displayName: r.display_name ?? r.login ?? "",
        plan: r.credential?.parameters?.short_label ?? "free",
      };
    },

    /** `catalog/search?type=tracks`, streamable hits only. */
    async search(q: string, limit = 10): Promise<Track[]> {
      const r = await call<{ tracks: { items: RawTrack[] } }>(
        "catalog/search",
        { query: q, type: "tracks", limit: String(limit) },
        await app(),
      );
      return r.tracks.items.map(toTrack).filter((t) => t.streamable);
    },

    /** The record's CDN URL, MP3 320, good for minutes — fetch it now. */
    async fileUrl(trackId: string): Promise<FileUrl> {
      return fileUrlWith(trackId, await app());
    },

    /** The record's bytes. A 30-second sample instead of the record means the token's plan lapsed. */
    async download(trackId: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
      const f = await fileUrlWith(trackId, await app());
      const res = await fetch(f.url);
      if (!res.ok) throw new QobuzError(`qobuz cdn failed (${res.status})`, res.status, await res.text());
      return { bytes: new Uint8Array(await res.arrayBuffer()), mimeType: f.mimeType };
    },
  };
}

export type Qobuz = ReturnType<typeof qobuz>;
