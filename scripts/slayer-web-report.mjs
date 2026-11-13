import { readFile, writeFile } from "node:fs/promises";
import { score, summarize } from "../eval/tiny-decision/metrics.mjs";

// Scoring happens outside the browser after inference. The label-bearing jobs
// never enter the browser, which receives only token IDs and legal option IDs.
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const index = arg.indexOf("=");
    return [arg.slice(2, index), arg.slice(index + 1)];
  }),
);
if (!args.input || !args.jobs || !args.reference)
  throw new Error(
    "--input=browser.json --jobs=original-jobs.json --reference=native.json required",
  );
const report = JSON.parse(await readFile(args.input, "utf8"));
const jobs = JSON.parse(await readFile(args.jobs, "utf8"));
const native = JSON.parse(await readFile(args.reference, "utf8"));
if (!report.finishedAt || report.rows?.length !== jobs.cases.length)
  throw new Error("Browser inference is incomplete");
if (report.sourceSha256 !== native.datasetSha256)
  throw new Error("Different native/browser source jobs");
report.rows = report.rows.map((row) => {
  const matching = jobs.cases.filter(
    (job) =>
      job.id === row.id && (!row.template || job.template === row.template),
  );
  if (matching.length !== 1)
    throw new Error("Missing or ambiguous original job");
  const job = matching[0];
  return score(job, { ...row, template: job.template });
});
report.nativeComparison = report.rows.map((row) => {
  const reference = native.rows.find(
    (item) => item.id === row.id && item.template === row.template,
  );
  if (!reference) throw new Error(`Missing native row ${row.id}`);
  return {
    id: row.id,
    template: row.template,
    bothErrors: Boolean(row.error && reference.error),
    sameChoice: row.chosenId != null && row.chosenId === reference.chosenId,
    maxLogScoreError:
      row.logScores && reference.logScores
        ? Math.max(
            ...row.logScores.map((value, i) =>
              Math.abs(value - reference.logScores[i]),
            ),
          )
        : null,
  };
});
report.summary = summarize(report.rows);
report.successfulLatency = summarize(report.rows.filter((row) => !row.error));
report.gpuQueueSubmissionsMeasuredDuringRows = report.rows.reduce(
  (sum, row) => sum + (row.gpuQueueSubmissions || 0),
  0,
);
if (report.error) {
  if (!/^Error: No native reference for /.test(report.error))
    throw new Error("Unresolved browser/runtime failure; refusing to clear it");
  report.postprocessingRecovery = {
    originalError: report.error,
    reason:
      "Rejected context rows omitted template in the first harness version. Restored template and labels from unique original job IDs after all inference completed; no predictions or elapsed times were changed.",
  };
  delete report.error;
}
report.note =
  "Custom float32 ONNX Runtime 1.31.1 mixed WebGPU/CPU run. GPU queue calls are measured during each completed row. This full-prefix graph repeats inference for suffix branches and is not an optimized speed comparison with the CPU KV-trie runner. Errors remain in the denominator.";
await writeFile(
  args.output || args.input,
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      summary: report.summary,
      successfulLatency: report.successfulLatency,
      choicesAgree: report.nativeComparison.filter((row) => row.sameChoice)
        .length,
      pairedErrors: report.nativeComparison.filter((row) => row.bothErrors)
        .length,
      gpuQueueSubmissions: report.gpuQueueSubmissionsMeasuredDuringRows,
    },
    null,
    2,
  ),
);
