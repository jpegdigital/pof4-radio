/**
 * AWS Signature Version 4 for one request, by hand: the payload hashed into
 * `x-amz-content-sha256` (S3), `x-amz-date`, the canonical request, the string to sign, the HMAC
 * chain, the `Authorization` header. Web Crypto only — no Node-only APIs, no SDK. Used for the three
 * verbs the clips bucket needs (`PUT`, `GET`, `HEAD`); tested against the AWS test vector.
 */

export interface SignInput {
  method: string;
  url: URL;
  /** Extra headers to send and sign (e.g. content-type). `host` is always signed. */
  headers?: Record<string, string>;
  body?: Uint8Array | string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  now?: Date;
}

const enc = new TextEncoder();

const hex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

const sha256 = async (data: Uint8Array | string): Promise<string> =>
  hex(
    await crypto.subtle.digest(
      "SHA-256",
      typeof data === "string" ? enc.encode(data) : (data as BufferSource),
    ),
  );

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", k, enc.encode(data));
}

/** RFC 3986 encoding as SigV4 wants it (`encodeURIComponent` plus the five it leaves alone). */
const rfc3986 = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** The path with each segment encoded (once — the URL's pathname is already percent-encoded). */
const canonicalPath = (url: URL) =>
  url.pathname
    .split("/")
    .map((seg) => rfc3986(decodeURIComponent(seg)))
    .join("/") || "/";

const canonicalQuery = (url: URL) =>
  [...url.searchParams.entries()]
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

/** The headers to send, including `Authorization`. (`host` is signed but left to `fetch`.) */
export async function sign(input: SignInput): Promise<Record<string, string>> {
  const now = input.now ?? new Date();
  const amzDate = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await sha256(input.body ?? "");

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers ?? {})) headers[k.toLowerCase()] = v.trim();
  headers["x-amz-date"] = amzDate;
  if (input.service === "s3") headers["x-amz-content-sha256"] = payloadHash;
  const signed: Record<string, string> = { ...headers, host: input.url.host };
  const names = Object.keys(signed).sort();
  const canonicalHeaders = names.map((n) => `${n}:${signed[n]}\n`).join("");
  const signedHeaders = names.join(";");

  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalPath(input.url),
    canonicalQuery(input.url),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256(canonicalRequest)].join("\n");

  const kDate = await hmac(enc.encode(`AWS4${input.secretAccessKey}`), dateStamp);
  const kRegion = await hmac(kDate, input.region);
  const kService = await hmac(kRegion, input.service);
  const kSigning = await hmac(kService, "aws4_request");
  const signature = hex(await hmac(kSigning, stringToSign));

  headers.authorization = `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return headers;
}
