/** Billed catalog planning check. Runs songs concurrently and saves receipts for listening review.
 * op run --env-file=.env.op -- node apps/web/scripts/plan-eval.mts <new-report.json>
 * Timing estimates are NOT accuracy scores: label first vocals against the actual recordings.
 */
import { writeFile } from "node:fs/promises";
import { qobuz } from "../src/app/api/sessions/qobuz.ts";
import { producePick, PICK_MODEL } from "../src/app/api/sessions/pick.ts";
import { producePlan } from "../src/app/api/sessions/planning.ts";
const e = process.env;
if (!e.TYPESAFE_API_KEY || !e.QOBUZ_TOKEN) throw new Error("TYPESAFE_API_KEY and QOBUZ_TOKEN required");
const destination = process.argv[2];
if (!destination) throw new Error("Supply a new report path");
const config = { apiKey: e.TYPESAFE_API_KEY, model: e.TYPESAFE_MODEL ?? PICK_MODEL };
const q = qobuz({ token: e.QOBUZ_TOKEN, appId: e.QOBUZ_APP_ID, secret: e.QOBUZ_SECRET });
const cases = [
  { artist: "Dire Straits", title: "Money for Nothing" },
  { artist: "Fleetwood Mac", title: "Dreams" },
  { artist: "The Beatles", title: "Hey Jude" },
  { artist: "Booker T. & The M.G.'s", title: "Green Onions" },
];
const started = Date.now();
const results = await Promise.allSettled(
  cases.map(async (proposal) => {
    const prompt =
      "Play " +
      proposal.title +
      " by " +
      proposal.artist +
      ", original studio version, with a brief radio introduction when it suits the track.";
    const hits = await q.search(proposal.artist + " " + proposal.title, 3);
    const selection = await producePick(
      { prompt, proposal: { ...proposal, why: "planning evaluation" }, hits },
      config,
    );
    const hit = hits.find((h) => h.id === selection.pick);
    if (!hit) throw new Error("No matching recording: " + proposal.title);
    const planning = await producePlan(
      {
        prompt,
        seq: 2,
        clockSaysBreak: false,
        proposal: { ...proposal, why: "planning evaluation" },
        hit,
        recent: [],
      },
      config,
    );
    return { proposal, selection, planning, observedFirstVocalMs: null };
  }),
);
const report = {
  at: new Date().toISOString(),
  model: config.model,
  wallMs: Date.now() - started,
  cases: results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { proposal: cases[i], error: r.reason instanceof Error ? r.reason.message : String(r.reason) },
  ),
};
await writeFile(destination, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
for (const r of report.cases)
  console.log(
    "error" in r
      ? { title: r.proposal.title, error: r.error }
      : {
          title: r.proposal.title,
          recording: r.selection.pick,
          kind: r.planning.plan.kind,
          introMs: r.planning.plan.chart.rampMs,
          post: r.planning.plan.chart.post,
          planningMs: r.planning.elapsedMs,
          wordsMax: r.planning.plan.wordsMax,
        },
  );
console.log({
  report: destination,
  wallMs: report.wallMs,
  accuracy: "Requires listening labels; not measured",
});
if (results.some((r) => r.status === "rejected")) process.exitCode = 1;
