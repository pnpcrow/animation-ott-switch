import { readFile, writeFile } from "node:fs/promises";
import { diagnosticSummary } from "../eval/tiny-decision/v2/needle/diagnostics.mjs";
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const i = arg.indexOf("=");
    return [arg.slice(2, i), arg.slice(i + 1)];
  }),
);
if (!args.input || !args.output)
  throw new Error("--input=completed.json --output=summary.json required");
const raw = JSON.parse(await readFile(args.input, "utf8"));
if (!raw.finishedAt || raw.error)
  throw new Error("Complete successful report required");
const report = {
  model: raw.model,
  engine: raw.engine,
  source: args.input,
  selection: raw.selection,
  templateSha256: raw.templateSha256,
  featureSourceSha256: raw.featureSourceSha256,
  choiceGuardSha256: raw.choiceGuardSha256,
  runnerSha256: raw.runnerSha256,
  parserBoundary: raw.parserBoundary,
  finishedAt: raw.finishedAt,
  runs: raw.runs.map((run) => ({
    template: run.template,
    stage: run.split,
    summary: run.summary,
    diagnostics: diagnosticSummary(run.rows),
  })),
};
await writeFile(args.output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
