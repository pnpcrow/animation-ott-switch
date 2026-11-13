import { readFile, writeFile } from "node:fs/promises";
import { hash } from "../eval/tiny-decision/metrics.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const separator = arg.indexOf("=");
    return [arg.slice(2, separator), arg.slice(separator + 1)];
  }),
);
if (!args.report || !args.output)
  throw new Error("--report=path --output=path required");
const reportText = await readFile(args.report, "utf8");
const report = JSON.parse(reportText);
if (!report.finishedAt) throw new Error("Cannot archive incomplete inference");
const jobsText = await readFile(report.sourceJobs, "utf8");
if (hash(jobsText) !== report.sourceJobsSha256)
  throw new Error("Source jobs changed after inference");
const jobs = JSON.parse(jobsText).cases;
const rows = report.rows.map((row) => {
  const matches = jobs.filter(
    (job) => job.id === row.id && job.template === row.template,
  );
  if (matches.length !== 1) throw new Error("Ambiguous source job");
  const job = matches[0];
  const variants = job.promptVariants || [
    { textLimit: null, prompt: job.prompt },
  ];
  const variant = variants.find(
    (item) => item.textLimit === row.chosenTextLimit,
  );
  if (!variant || hash(variant.prompt) !== row.budget.promptSha256)
    throw new Error("Chosen prompt does not match budget audit");
  if (row.promptSha256 && row.promptSha256 !== hash(variant.prompt))
    throw new Error("Chosen prompt does not match inference hash");
  return {
    id: row.id,
    field: row.field,
    template: row.template,
    split: row.split,
    indexBase: job.indexBase,
    orderedOptionIds: job.options.map((option) => option.id),
    chosenTextLimit: row.chosenTextLimit,
    budget: row.budget,
    prompt: variant.prompt,
  };
});
await writeFile(
  args.output,
  JSON.stringify(
    {
      schemaVersion: 2,
      report: args.report,
      reportSha256: hash(reportText),
      sourceJobsSha256: report.sourceJobsSha256,
      frame:
        "Direct State/Options instructions ending in Best answer: [; no chat template; complete numeric bracket suffix scores",
      policy:
        "Observed facts only; first predeclared text tier fitting native 2048-token context including suffix, retaining all candidates. No gold labels included in this input archive.",
      rows,
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ output: args.output, rows: rows.length }));
