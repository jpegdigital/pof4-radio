/**
 * `op run --env-file=.env.op -- node apps/web/scripts/bucket-smoke.mts` — one PUT, two GETs and
 * two HEADs against the real clips bucket with the hand-rolled signer (src/lib/sigv4.ts): proves
 * the signature, the path style, the 404 path and that HEAD reports a size (the pull rebuilds a
 * `track` row from it) before any slot is voiced. Writes one tiny object under `stations/_smoke/`.
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

const hh = await sign({ ...creds, method: "HEAD", url: put });
const hr = await fetch(put, { method: "HEAD", headers: hh });
await hr.arrayBuffer();
console.log(
  "HEAD",
  hr.status,
  "content-length",
  hr.headers.get("content-length"),
  `(sent ${body.byteLength})`,
);

const missing = new URL(`${base}/stations/_smoke/does-not-exist.txt`);
const mh = await sign({ ...creds, method: "GET", url: missing });
const mr = await fetch(missing, { headers: mh });
console.log("GET missing", mr.status);
await mr.arrayBuffer();

const mhh = await sign({ ...creds, method: "HEAD", url: missing });
const mhr = await fetch(missing, { method: "HEAD", headers: mhh });
await mhr.arrayBuffer();
console.log("HEAD missing", mhr.status, "(404 → the pull downloads)");
