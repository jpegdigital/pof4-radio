/**
 * `op run --env-file=.env.op -- node apps/web/scripts/qobuz-smoke.mts "Fleetwood Mac Dreams"` —
 * the whole record path against the real Qobuz with the hand-ported client
 * (src/app/api/sessions/qobuz.ts): resolve the app id + secret (QOBUZ_APP_ID / QOBUZ_SECRET or the
 * bundle scrape), prove the token with user/get, search, sign a getFileUrl for the first hit, pull
 * the MP3. Writes the record to the OS temp dir and prints its path; a ~10 MB file for a
 * four-minute song is the full record at 320, ~1 MB is the 30-second sample of a lapsed plan.
 */
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { qobuz } from "../src/app/api/sessions/qobuz.ts";

const e = process.env;
if (!e.QOBUZ_TOKEN) throw new Error("QOBUZ_TOKEN is not set");
const q = process.argv[2] ?? "Fleetwood Mac Dreams";
const client = qobuz({ token: e.QOBUZ_TOKEN, appId: e.QOBUZ_APP_ID, secret: e.QOBUZ_SECRET });

const t0 = Date.now();
const app = await client.app();
console.log(
  `app      id=${app.appId} secret=${app.secret} (${e.QOBUZ_SECRET ? "from env" : "scraped"}) ${Date.now() - t0} ms`,
);
if (!e.QOBUZ_SECRET)
  console.log(`         set QOBUZ_APP_ID=${app.appId} QOBUZ_SECRET=${app.secret} to skip the scrape`);

let t = Date.now();
const me = await client.me();
console.log(`me       #${me.id} ${me.displayName} plan=${me.plan} ${Date.now() - t} ms`);

t = Date.now();
const hits = await client.search(q, 5);
console.log(`search   "${q}" → ${hits.length} streamable ${Date.now() - t} ms`);
for (const h of hits)
  console.log(
    `  ${h.id.padStart(10)}  ${h.artists.join(", ")} — ${h.title}  (${h.album}, ${Math.round(h.durationMs / 1000)}s)`,
  );
if (hits.length === 0) throw new Error("no hits");

t = Date.now();
const f = await client.fileUrl(hits[0].id);
console.log(
  `fileUrl  ${f.mimeType} fmt=${f.formatId} ${f.samplingRate} kHz sample=${f.sample} ${new URL(f.url).host} ${Date.now() - t} ms`,
);

t = Date.now();
const rec = await client.download(hits[0].id);
const out = join(tmpdir(), `qobuz-${hits[0].id}.mp3`);
await writeFile(out, rec.bytes);
console.log(`download ${(rec.bytes.byteLength / 1e6).toFixed(1)} MB ${Date.now() - t} ms → ${out}`);
console.log(`\ntotal ${Date.now() - t0} ms`);
