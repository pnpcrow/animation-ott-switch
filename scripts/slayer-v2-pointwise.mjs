import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { hash, summarize } from "../eval/tiny-decision/metrics.mjs";
import {
  pointwiseProtocol,
  reconstructPointwise,
  choosePointwise,
  selectPointwiseThreshold,
} from "../eval/tiny-decision/v2/slayer/pointwise.mjs";
const args = Object.fromEntries(
  process.argv.slice(2).map((s) => {
    const i = s.indexOf("=");
    return [s.slice(2, i), s.slice(i + 1)];
  }),
);
if (!args.output || !["pilot", "holdout"].includes(args.mode))
  throw new Error("--mode=pilot|holdout --output=path required");
const codeSha256 = hash(
  (
    await Promise.all(
      [
        "eval/tiny-decision/v2/slayer/pointwise.mjs",
        "eval/tiny-decision/v2/features.mjs",
        "scripts/slayer-v2-pointwise-jobs.mjs",
      ].map((path) => readFile(path, "utf8")),
    )
  ).join("\n"),
);
let frozen;
if (args.mode === "holdout") {
  if (!args.selection || !args.inputs || !args.labels)
    throw new Error(
      "Holdout requires --selection plus explicit input/label files",
    );
  frozen = JSON.parse(await readFile(args.selection, "utf8"));
  if (
    !frozen.finishedAt ||
    !frozen.eligibleForFreshHoldout ||
    frozen.codeSha256 !== codeSha256
  )
    throw new Error(
      "Pilot did not authorize this unchanged fresh-holdout protocol",
    );
}
const run = (parameters) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, parameters, {
      stdio: "inherit",
      shell: false,
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Subprocess exited ${code}`)),
    );
  });
const stem = args.output.replace(/\.json$/, "");
await mkdir(dirname(args.output), { recursive: true });
const jobs = `${stem}-jobs.json`,
  inference = `${stem}-inference.json`;
const prepare = ["scripts/slayer-v2-pointwise-jobs.mjs", `--output=${jobs}`];
if (args.mode === "pilot") prepare.push("--sample=screen");
for (const key of ["inputs", "labels"])
  if (args[key]) prepare.push(`--${key}=${args[key]}`);
await run(prepare);
await run([
  "scripts/slayer-v2-eval.mjs",
  `--jobs=${jobs}`,
  `--output=${inference}`,
]);
const prepared = JSON.parse(await readFile(jobs, "utf8")),
  raw = JSON.parse(await readFile(inference, "utf8"));
if (!raw.finishedAt) throw new Error("Binary inference is incomplete");
const scored = reconstructPointwise(prepared.parentCases, prepared.cases, raw);
if (args.mode === "pilot" && scored.some((row) => row.split !== "development"))
  throw new Error("Pilot received non-development data");
const selection =
  args.mode === "pilot"
    ? {
        ...selectPointwiseThreshold(scored),
        lockedAt: new Date().toISOString(),
      }
    : frozen.selection;
const rows = scored.map((row) => choosePointwise(row, selection.threshold));
const summary = summarize(rows),
  positive = rows.filter((row) => row.expectedId !== "__none__"),
  negative = rows.filter((row) => row.expectedId === "__none__");
let bestMulticlassAccuracy = null;
if (args.mode === "pilot") {
  const screen = JSON.parse(
    await readFile(
      args.screen || "eval/tiny-decision/v2/slayer/screen.json",
      "utf8",
    ),
  );
  if (!screen.finishedAt)
    throw new Error("Complete multiclass screening before applying pilot gate");
  bestMulticlassAccuracy = Math.max(
    ...screen.summaries.map((row) => row.summary.accuracy),
  );
}
const positiveCorrect = positive.filter((row) => row.correct).length;
const eligibleForFreshHoldout =
  args.mode === "pilot" &&
  summary.accuracy > negative.length / rows.length &&
  summary.accuracy > bestMulticlassAccuracy &&
  positiveCorrect >= 2;
const report = {
  schemaVersion: 2,
  mode: args.mode,
  model: raw.model,
  runtime: raw.runtime,
  protocol: pointwiseProtocol,
  codeSha256,
  sourceJobs: jobs,
  inferenceReport: inference,
  sampling: prepared.sampling,
  selection,
  summary,
  positive: { n: positive.length, correct: positiveCorrect },
  absent: {
    n: negative.length,
    correct: negative.filter((row) => row.correct).length,
  },
  constantNone: {
    correct: negative.length,
    n: rows.length,
    accuracy: negative.length / rows.length,
  },
  bestMulticlassAccuracy,
  eligibleForFreshHoldout,
  totalCandidateCalls: rows.reduce((sum, row) => sum + row.calls, 0),
  totalInferenceMs: rows.reduce((sum, row) => sum + row.elapsedMs, 0),
  disagreeingLabelOrderDecisions: rows
    .flatMap((row) => row.candidates)
    .filter(
      (candidate) =>
        candidate.valid &&
        candidate.originalOrderWouldQualify !==
          candidate.reversedOrderWouldQualify,
    ).length,
  note: "Symmetric full-suffix log-odds, not calibrated correctness probability. Each parent latency is the sum of all candidate/order calls. Pilot scores optimize one threshold on these same development cases and are optimistic; fresh holdout is separate.",
  rows,
  finishedAt: new Date().toISOString(),
};
await writeFile(args.output, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    mode: report.mode,
    summary,
    positive: report.positive,
    absent: report.absent,
    constantNone: report.constantNone,
    threshold: selection.threshold,
    eligibleForFreshHoldout,
    totalCandidateCalls: report.totalCandidateCalls,
    totalInferenceMs: report.totalInferenceMs,
  }),
);
