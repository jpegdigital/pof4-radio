/** Live source desk, no secrets: --save <json>, --replay <json>, --html <html>. */
import { readFile, writeFile } from "node:fs/promises";
import { NEWS_DEFAULTS, NewsConfig } from "../src/lib/news.ts";
import { eligibleArticles, readHeadlines, type HeadlineSnapshot } from "../src/app/api/sessions/headlines.ts";

const args = process.argv.slice(2);
const option = (name: string) => {
  const at = args.indexOf(name);
  return at < 0 ? null : (args[at + 1] ?? null);
};
const started = Date.now();
const replay = option("--replay");
const snapshot: HeadlineSnapshot = replay
  ? (JSON.parse(await readFile(replay, "utf8")) as HeadlineSnapshot)
  : await readHeadlines(NEWS_DEFAULTS);
NewsConfig.parse(snapshot.config);
const eligible = eligibleArticles(snapshot.articles, replay ? Date.parse(snapshot.at) : Date.now());
console.log(
  JSON.stringify(
    {
      snapshotId: snapshot.id,
      at: snapshot.at,
      elapsedMs: Date.now() - started,
      sources: snapshot.sources,
      articles: snapshot.articles.length,
      eligible: eligible.length,
      withEvidence: eligible.filter((a) => a.evidence.length >= 60).length,
      sample: eligible
        .slice(0, 6)
        .map((a) => ({ title: a.title, source: a.source, at: a.at, evidenceChars: a.evidence.length })),
    },
    null,
    2,
  ),
);
const save = option("--save");
if (save) await writeFile(save, `${JSON.stringify(snapshot, null, 2)}\n`);
const html = option("--html");
if (html) {
  const esc = (s: string) =>
    s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const ids = new Set(eligible.map((a) => a.id));
  await writeFile(
    html,
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Radio news desk</title><style>body{max-width:1000px;margin:40px auto;padding:20px;background:#f6f3ec;color:#202820;font:16px/1.6 system-ui}article{padding:20px 0;border-top:1px solid #ccc}small{color:#536053}a{color:#246744}blockquote{border-left:3px solid #ccc;padding-left:20px}</style><h1>Radio news desk</h1><p>Snapshot ${esc(snapshot.at)} · ${snapshot.articles.length} articles · ${eligible.length} within age policy</p><p>This is a discovery/evidence report. Editorial selection and checking run in the control room preview.</p>${snapshot.sources.map((s) => `<p>${esc(s.id)}: ${s.status}, ${s.count} items${s.error ? ` — ${esc(s.error)}` : ""}</p>`).join("")}${snapshot.articles.map((a) => `<article><small>${esc(a.scope)} · ${esc(a.source)} · ${esc(a.at || "unknown date")}</small><h2>${esc(a.title)}</h2><p>${ids.has(a.id) ? (a.evidence ? "Evidence available for editorial review" : "Discovery only; no article evidence") : "Rejected: age, URL, source or duplicate"}</p>${a.url ? `<a href="${esc(a.url)}">Source</a>` : ""}<blockquote>${esc(a.evidence || "No publisher excerpt")}</blockquote></article>`).join("")}</html>\n`,
  );
}
if (!snapshot.sources.some((s) => s.status === "fresh")) process.exitCode = 1;
