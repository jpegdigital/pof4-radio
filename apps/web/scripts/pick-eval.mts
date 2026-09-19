/**
 * Billed, manual Jev evaluation. No Claude, Qobuz, TTS, or database writes.
 * op run --env-file=.env.op -- node apps/web/scripts/pick-eval.mts [cases.json] [report.json]
 * A report is also a valid input: edit its acceptable IDs and replay it.
 */
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { PICK_MODEL, PickInput, type PickReceipt, producePick } from "../src/app/api/sessions/pick.ts";

const Suite = z.object({
  cases: z
    .array(
      z.object({
        id: z.string().min(1),
        input: PickInput,
        acceptable: z.array(z.string().nullable()).min(1),
      }),
    )
    .min(1),
});
const source = process.argv[2] ?? new URL("./fixtures/picks.json", import.meta.url);
const destination = process.argv[3];
const suite = Suite.parse(JSON.parse(await readFile(source, "utf8")));
const apiKey = process.env.TYPESAFE_API_KEY;
if (!apiKey) throw new Error("TYPESAFE_API_KEY required (run through op run --env-file=.env.op)");
const model = process.env.TYPESAFE_MODEL ?? PICK_MODEL;
const results: (z.infer<typeof Suite>["cases"][number] & {
  passed: boolean;
  receipt?: PickReceipt;
  error?: string;
})[] = [];
for (const test of suite.cases) {
  if (test.acceptable.some((id) => id !== null && !test.input.hits.some((hit) => hit.id === id)))
    throw new Error(`${test.id}: acceptable ID is absent from the supplied hits`);
  try {
    const receipt = await producePick(test.input, { apiKey, model });
    const passed = test.acceptable.includes(receipt.pick);
    results.push({ ...test, passed, receipt });
    console.error(
      `${passed ? "PASS" : "FAIL"} ${test.id}: ${receipt.pick ?? "none"}, ${receipt.elapsedMs}ms`,
    );
  } catch (error) {
    // Continue only to finish the evaluation report. This case failed; never substitute a pick.
    const message = error instanceof Error ? error.message : String(error);
    results.push({ ...test, passed: false, error: message });
    console.error(`ERROR ${test.id}: ${message}`);
  }
}
const receipts = results.flatMap((r) => (r.receipt ? [r.receipt] : []));
const latencies = receipts.map((r) => r.elapsedMs).sort((a, b) => a - b);
const summary = {
  cases: results.length,
  passed: results.filter((r) => r.passed).length,
  errors: results.filter((r) => "error" in r).length,
  noMatch: receipts.filter((r) => r.pick === null).length,
  medianMs: latencies.length ? latencies[Math.floor(latencies.length / 2)] : null,
  maxMs: latencies.at(-1) ?? null,
  inputTokens: receipts.reduce((n, r) => n + r.response.usage.input_tokens, 0),
  outputTokens: receipts.reduce((n, r) => n + r.response.usage.output_tokens, 0),
};
const report = { at: new Date().toISOString(), model, summary, cases: results };
if (destination) await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify(destination ? summary : report, null, 2));
if (summary.passed !== summary.cases) process.exitCode = 1;
