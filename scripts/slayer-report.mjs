import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { summarize, selectTemplate } from "../eval/tiny-decision/metrics.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const index = arg.indexOf("=");
    return [arg.slice(2, index), arg.slice(index + 1)];
  }),
);
if (!args.input || !args.output)
  throw new Error("--input=raw.json --output=summary.json required");
const raw = JSON.parse(await readFile(args.input, "utf8"));
if (!raw.finishedAt)
  throw new Error("The source inference run is still incomplete");
const keys = [
  ...new Set(raw.rows.map((row) => `${row.split}/${row.template}`)),
];
const reports = keys.map((key) => {
  const rows = raw.rows.filter((row) => `${row.split}/${row.template}` === key);
  return {
    split: rows[0].split,
    template: rows[0].template,
    summary: summarize(rows),
    successfulLatency: summarize(rows.filter((row) => !row.error)),
    rows,
  };
});
const report = {
  schemaVersion: 1,
  label: raw.label,
  model: raw.model,
  revision: raw.revision,
  runtime: raw.runtime,
  source: args.input,
  datasetSha256: raw.datasetSha256,
  timingCaveat:
    "CPU 4 threads; runs overlapped other model and browser work. Timings are contended, not a controlled hardware comparison. Context-budget errors include no inference. successfulLatency separates completed inference from rejected inputs.",
  reports,
};
if (reports.every((item) => item.split === "calibration")) {
  const selection = selectTemplate(reports);
  let previous;
  try {
    previous = JSON.parse(await readFile(args.output, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const unchanged =
    previous?.revision === raw.revision &&
    previous?.selection?.sourceSha256 === raw.datasetSha256 &&
    previous?.selection?.template === selection.template;
  report.selection = {
    ...selection,
    lockedAt: unchanged
      ? previous.selection.lockedAt
      : new Date().toISOString(),
    sourceSha256: raw.datasetSha256,
  };
}
await mkdir(dirname(args.output), { recursive: true });
await writeFile(args.output, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      summaries: reports.map(({ split, template, summary }) => ({
        split,
        template,
        summary,
      })),
      selection: report.selection,
    },
    null,
    2,
  ),
);
