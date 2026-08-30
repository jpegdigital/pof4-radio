/**
 * Unpack a classic Winamp skin (`.wsz` — a zip of BMP sprite sheets and a few text files) into
 * the assets the /winamp view draws from:
 *
 *   apps/web/public/winamp/<name>/*.bmp, *.txt      the sheets, names lowercased and flattened
 *   apps/web/src/components/winamp/skins/<name>.json the playlist colours from pledit.txt
 *
 * Zero dependencies (the zip is walked by hand, entries inflated with node:zlib), so it runs as
 * `node apps/web/scripts/winamp-skin.mts <skin.wsz> [name]` on Node 24 without a build step.
 * The sheets are served as BMP as-is — every browser decodes them — so nothing is re-encoded.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";

const [, , file, nameArg] = process.argv;
if (!file) {
  console.error("usage: node apps/web/scripts/winamp-skin.mts <skin.wsz> [name]");
  process.exit(1);
}
const name = (nameArg ?? basename(file, extname(file))).toLowerCase().replace(/[^a-z0-9-]+/g, "-");
const web = resolve(import.meta.dirname, "..");
const assetDir = join(web, "public", "winamp", name);
const skinsDir = join(web, "src", "components", "winamp", "skins");
mkdirSync(assetDir, { recursive: true });
mkdirSync(skinsDir, { recursive: true });

const zip = readFileSync(resolve(file));
const KEEP = new Set([".bmp", ".txt"]);
let written = 0;
let pledit = "";
for (const e of entries(zip)) {
  const base = basename(e.name).toLowerCase();
  const ext = extname(base);
  if (!KEEP.has(ext) || base.startsWith(".")) continue;
  writeFileSync(join(assetDir, base), e.data);
  written++;
  if (base === "pledit.txt") pledit = e.data.toString("latin1");
}

const text = parseIni(pledit)["text"] ?? {};
const skin = {
  name,
  text: {
    normal: text["normal"] ?? "#00FF00",
    current: text["current"] ?? "#FFFFFF",
    normalBg: text["normalbg"] ?? "#000000",
    selectedBg: text["selectedbg"] ?? "#0000FF",
    font: text["font"] ?? "Arial",
  },
};
writeFileSync(join(skinsDir, `${name}.json`), `${JSON.stringify(skin, null, 2)}\n`);
console.log(`${name}: ${written} files → ${assetDir}`);

/** The zip's central directory, walked backwards from its end record. */
function* entries(buf: Buffer): Generator<{ name: string; data: Buffer }> {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory");
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const entryName = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (entryName.endsWith("/")) continue;
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + size);
    if (method === 0) yield { name: entryName, data: raw };
    else if (method === 8) yield { name: entryName, data: inflateRawSync(raw) };
    else throw new Error(`${entryName}: unsupported compression ${method}`);
  }
}

/** `[section]` / `key=value` lines, keys and sections lowercased. */
function parseIni(src: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  let section = "";
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(";")) continue;
    const sec = line.match(/^\[(.+)\]$/);
    if (sec) {
      section = sec[1].toLowerCase();
      out[section] ??= {};
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    (out[section] ??= {})[line.slice(0, eq).trim().toLowerCase()] = line.slice(eq + 1).trim();
  }
  return out;
}
