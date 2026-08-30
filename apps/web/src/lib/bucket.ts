import { env } from "./env";
import { sign } from "./sigv4";

/**
 * The clips bucket (Railway's `radio-clips`, S3-compatible): two verbs over `fetch` with the
 * request signed by hand (sigv4.ts). Path-style URLs (`<endpoint>/<bucket>/<key>`). Null when the
 * five `BUCKET_*` vars aren't all set — the voice and clip routes answer 503 then.
 */

export interface Bucket {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  open(
    key: string,
  ): Promise<{ body: ReadableStream<Uint8Array>; contentType: string; contentLength: number | null } | null>;
}

/** Where a segment's clips live: one object per voiced slot, written once. */
export const clipKey = (stationId: string, segmentId: string, seq: number) =>
  `stations/${stationId}/${segmentId}/${seq}.mp3`;

interface Config {
  endpoint: string;
  name: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

function configFromEnv(): Config | null {
  const e = env();
  if (
    !e.BUCKET_ENDPOINT ||
    !e.BUCKET_NAME ||
    !e.BUCKET_REGION ||
    !e.BUCKET_ACCESS_KEY_ID ||
    !e.BUCKET_SECRET_ACCESS_KEY
  )
    return null;
  return {
    endpoint: e.BUCKET_ENDPOINT.replace(/\/$/, ""),
    name: e.BUCKET_NAME,
    region: e.BUCKET_REGION,
    accessKeyId: e.BUCKET_ACCESS_KEY_ID,
    secretAccessKey: e.BUCKET_SECRET_ACCESS_KEY,
  };
}

/** The env var a missing bucket needs, for the 503's message. */
export function bucketMissing(): string | null {
  const e = env();
  for (const k of [
    "BUCKET_ENDPOINT",
    "BUCKET_NAME",
    "BUCKET_REGION",
    "BUCKET_ACCESS_KEY_ID",
    "BUCKET_SECRET_ACCESS_KEY",
  ] as const)
    if (!e[k]) return k;
  return null;
}

async function failure(what: string, res: Response): Promise<Error> {
  const text = await res.text().catch(() => "");
  return new Error(`bucket ${what} ${res.status}: ${text.slice(0, 200)}`);
}

function createBucket(c: Config): Bucket {
  const urlOf = (key: string) => new URL(`${c.endpoint}/${c.name}/${key}`);
  const creds = {
    region: c.region,
    service: "s3",
    accessKeyId: c.accessKeyId,
    secretAccessKey: c.secretAccessKey,
  };
  return {
    async put(key, bytes, contentType) {
      const url = urlOf(key);
      const headers = await sign({
        ...creds,
        method: "PUT",
        url,
        headers: { "content-type": contentType, "content-length": String(bytes.byteLength) },
        body: bytes,
      });
      const res = await fetch(url, { method: "PUT", headers, body: bytes as BodyInit });
      if (!res.ok) throw await failure(`put ${key}`, res);
      await res.arrayBuffer().catch(() => {});
    },
    async open(key) {
      const url = urlOf(key);
      const headers = await sign({ ...creds, method: "GET", url });
      const res = await fetch(url, { headers });
      if (res.status === 404) {
        await res.arrayBuffer().catch(() => {});
        return null;
      }
      if (!res.ok || !res.body) throw await failure(`get ${key}`, res);
      const len = res.headers.get("content-length");
      return {
        body: res.body,
        contentType: res.headers.get("content-type") ?? "application/octet-stream",
        contentLength: len ? Number(len) : null,
      };
    },
  };
}

// One client per server process (survives HMR in dev via globalThis), like db().
const g = globalThis as unknown as { __bucket?: Bucket | null };

export function bucket(): Bucket | null {
  if (g.__bucket === undefined) {
    const c = configFromEnv();
    g.__bucket = c ? createBucket(c) : null;
  }
  return g.__bucket;
}
