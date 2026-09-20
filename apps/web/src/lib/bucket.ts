import { env } from "./env";
import { sign } from "./sigv4";

/**
 * The clips bucket (Railway's `radio-clips`, S3-compatible): three verbs over `fetch` with the
 * request signed by hand (sigv4.ts). Path-style URLs (`<endpoint>/<bucket>/<key>`). The voice clips
 * live under `sessions/`, the tracks under `tracks/` (the routes name the keys). `head` is how the
 * pull finds bytes it has no row for (a `track` row is rebuilt from the tags, no download). The
 * five `BUCKET_*` vars are required by `env`: a missing one is its fault to name, not a null here.
 */

export interface Bucket {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  open(
    key: string,
  ): Promise<{ body: ReadableStream<Uint8Array>; contentType: string; contentLength: number | null } | null>;
  /** Whether the key holds bytes, and how many; null when it does not. */
  head(key: string): Promise<{ contentLength: number | null } | null>;
}

interface Config {
  endpoint: string;
  name: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

function configFromEnv(): Config {
  const e = env();
  return {
    endpoint: e.BUCKET_ENDPOINT.replace(/\/$/, ""),
    name: e.BUCKET_NAME,
    region: e.BUCKET_REGION,
    accessKeyId: e.BUCKET_ACCESS_KEY_ID,
    secretAccessKey: e.BUCKET_SECRET_ACCESS_KEY,
  };
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
    async head(key) {
      const url = urlOf(key);
      const headers = await sign({ ...creds, method: "HEAD", url });
      const res = await fetch(url, { method: "HEAD", headers });
      await res.arrayBuffer().catch(() => {});
      if (res.status === 404) return null;
      if (!res.ok) throw await failure(`head ${key}`, res);
      const len = res.headers.get("content-length");
      return { contentLength: len ? Number(len) : null };
    },
  };
}

// One client per server process (survives HMR in dev via globalThis), like db().
const g = globalThis as unknown as { __bucket?: Bucket };

export function bucket(): Bucket {
  g.__bucket ??= createBucket(configFromEnv());
  return g.__bucket;
}
