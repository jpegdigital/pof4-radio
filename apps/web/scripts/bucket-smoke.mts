/**
 * `op run --env-file=.env.op -- node apps/web/scripts/bucket-smoke.mts` — one PUT and two GETs
 * against the real clips bucket with the hand-rolled signer (src/lib/sigv4.ts): proves the
 * signature, the path style and the 404 path before any segment is voiced. Writes one tiny
 * object under `stations/_smoke/`.
 */
import { sign } from "../src/lib/sigv4.ts";

const e = process.env;
const need = [
  "BUCKET_ENDPOINT",
  "BUCKET_NAME",
  "BUCKET_REGION",
  "BUCKET_ACCESS_KEY_ID",
  "BUCKET_SECRET_ACCESS_KEY",
];
for (const k of need) if (!e[k]) throw new Error(`${k} is not set`);
const creds = {
  region: e.BUCKET_REGION as string,
  service: "s3",
  accessKeyId: e.BUCKET_ACCESS_KEY_ID as string,
  secretAccessKey: e.BUCKET_SECRET_ACCESS_KEY as string,
};
const base = `${(e.BUCKET_ENDPOINT as string).replace(/\/$/, "")}/${e.BUCKET_NAME}`;
const key = `stations/_smoke/${Date.now()}.txt`;
const body = new TextEncoder().encode(`smoke ${new Date().toISOString()}`);

const put = new URL(`${base}/${key}`);
const ph = await sign({ ...creds, method: "PUT", url: put, headers: { "content-type": "text/plain" }, body });
const pr = await fetch(put, { method: "PUT", headers: ph, body });
console.log("PUT", key, pr.status, pr.ok ? "" : (await pr.text()).slice(0, 300));

const gh = await sign({ ...creds, method: "GET", url: put });
const gr = await fetch(put, { headers: gh });
console.log("GET", gr.status, gr.headers.get("content-type"), JSON.stringify(await gr.text()));

const missing = new URL(`${base}/stations/_smoke/does-not-exist.txt`);
const mh = await sign({ ...creds, method: "GET", url: missing });
const mr = await fetch(missing, { headers: mh });
console.log("GET missing", mr.status);
await mr.arrayBuffer();
