import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { preparePairs } from "../templates.mjs";
import { selectConfiguration, scoreCases } from "../../light-dom/selection.mjs";
import { summarize } from "../../tiny-decision/metrics.mjs";

const outputDirectory = "eval/dom-adaptation/templates";
const temporaryDirectory = ".tmp/dom-adaptation/templates";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const read = async path => JSON.parse(await readFile(path));
const write = async (path, data) => writeFile(path, JSON.stringify(data, null, 2) + "\n");
const sourcePaths = ["eval/dom-adaptation/templates.mjs", "eval/tiny-decision/v2/features.mjs", "eval/light-dom/nli/run.py", "eval/light-dom/selection.mjs"];
const hashes = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, digest(await readFile(path))])));
const mode = process.argv[2];
await mkdir(outputDirectory, { recursive: true });
await mkdir(temporaryDirectory, { recursive: true });

if (mode === "prepare-development" || mode === "prepare-retrospective") {
  const split = mode === "prepare-development" ? "development" : "retrospective";
  const inputPath = `eval/light-dom/data/${split === "development" ? "development" : "holdout"}-inputs.json`;
  const inputBytes = await readFile(inputPath);
  const jobs = preparePairs(JSON.parse(inputBytes));
  jobs.inputsSha256 = digest(inputBytes);
  jobs.templateSha256 = digest(await readFile("eval/dom-adaptation/templates.mjs"));
  jobs.inputPath = inputPath;
  jobs.preparedAt = new Date().toISOString();
  jobs.evaluationStatus = "Previously consumed observations. Development/retrospective comparison only; no fresh holdout or generalization claim.";
  if (split === "retrospective") {
    const lock = await read(`${outputDirectory}/selection.json`);
    if (JSON.stringify(lock.sourceHashes) !== JSON.stringify(await hashes())) throw new Error("Template or runner changed after development selection");
    jobs.selectionSha256 = digest(await readFile(`${outputDirectory}/selection.json`));
  }
  const path = `${temporaryDirectory}/${split}-jobs.json`;
  await write(path, jobs);
  console.log(JSON.stringify({ path, cases: jobs.cases.length, pairs: jobs.pairs.length }));
} else if (mode === "select") {
  const jobsBytes = await readFile(`${temporaryDirectory}/development-jobs.json`);
  const jobs = JSON.parse(jobsBytes);
  const reportBytes = await readFile(`${outputDirectory}/development.json`);
  const report = JSON.parse(reportBytes);
  if (report.jobsSha256 !== digest(jobsBytes) || report.predictions.some(row => row.error)) throw new Error("Incomplete or mismatched development run");
  const labels = await read("eval/light-dom/data/development-labels.json");
  const selection = selectConfiguration(jobs, labels, report.predictions);
  selection.sourceHashes = await hashes();
  selection.developmentJobsSha256 = digest(jobsBytes);
  selection.developmentReportSha256 = digest(reportBytes);
  selection.developmentLabelsSha256 = digest(await readFile("eval/light-dom/data/development-labels.json"));
  selection.interpretation = "Only the previous 66 development cases choose templates/thresholds. All 84 observations have already been consumed by earlier experiments. This is not a new blind evaluation.";
  await write(`${outputDirectory}/selection.json`, selection);
  console.log(JSON.stringify(selection.selected));
} else if (mode === "report") {
  const selection = await read(`${outputDirectory}/selection.json`);
  if (JSON.stringify(selection.sourceHashes) !== JSON.stringify(await hashes())) throw new Error("Frozen sources changed");
  const report = { interpretation: selection.interpretation, selectedTemplate: selection.selected.template, sourceHashes: selection.sourceHashes, development: [], retrospective: [] };
  for (const split of ["development", "retrospective"]) {
    const jobsBytes = await readFile(`${outputDirectory}/plans/${split}-jobs.json`);
    const jobs = JSON.parse(jobsBytes);
    const run = await read(`${outputDirectory}/${split}.json`);
    if (run.jobsSha256 !== digest(jobsBytes) || run.predictions.some(row => row.error)) throw new Error("Incomplete or mismatched run");
    const labels = await read(`eval/light-dom/data/${split === "development" ? "development" : "holdout"}-labels.json`);
    for (const configuration of selection.perTemplate) {
      const rows = scoreCases(jobs, labels, run.predictions, configuration.template, configuration.threshold);
      report[split].push({
        template: configuration.template, threshold: configuration.threshold,
        selectedOnDevelopment: configuration.template === selection.selected.template,
        summary: summarize(rows), nontrivial: summarize(rows.filter(row => !row.trivialNoCandidate)),
        positiveCorrect: rows.filter(row => row.expectedId !== "__none__" && row.correct).length,
        positiveTotal: rows.filter(row => row.expectedId !== "__none__").length,
        negativeCorrect: rows.filter(row => row.expectedId === "__none__" && row.correct).length,
        negativeTotal: rows.filter(row => row.expectedId === "__none__").length,
        failures: run.predictions.filter(row => row.template === configuration.template && row.error).length,
        decisions: rows,
      });
    }
  }
  await write(`${outputDirectory}/comparison.json`, report);
  console.log(JSON.stringify({ development: report.development.map(({decisions, ...rest}) => rest), retrospective: report.retrospective.map(({decisions, ...rest}) => rest) }));
} else {
  throw new Error("Use prepare-development, select, prepare-retrospective, or report");
}
