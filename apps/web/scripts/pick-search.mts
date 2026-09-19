/**
 * Search real Qobuz recordings and let Jev pick, without creating a session or voicing it.
 * op run --env-file=.env.op -- node apps/web/scripts/pick-search.mts "prompt" "artist" "title" [receipt.json]
 */
import { writeFile } from "node:fs/promises";
import { PICK_MODEL, producePick } from "../src/app/api/sessions/pick.ts";
import { qobuz } from "../src/app/api/sessions/qobuz.ts";

const [prompt, artist, title, destination] = process.argv.slice(2);
if (!prompt || !artist || !title)
  throw new Error('usage: pick-search.mts "prompt" "artist" "title" [receipt.json]');
const e = process.env;
if (!e.QOBUZ_TOKEN || !e.TYPESAFE_API_KEY) throw new Error("QOBUZ_TOKEN and TYPESAFE_API_KEY required");
const q = qobuz({ token: e.QOBUZ_TOKEN, appId: e.QOBUZ_APP_ID, secret: e.QOBUZ_SECRET });
// Match the fill's three-hit search. This script deliberately has no Claude imports.
const hits = await q.search(`${artist} ${title}`, 3);
const receipt = await producePick(
  {
    prompt,
    proposal: { artist, title, why: "Manual recording-selection evaluation" },
    hits,
  },
  { apiKey: e.TYPESAFE_API_KEY, model: e.TYPESAFE_MODEL ?? PICK_MODEL },
);
if (destination) await writeFile(destination, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify(receipt, null, 2));
if (receipt.pick === null) throw new Error("Jev found no suitable recording; no substitute was selected");
