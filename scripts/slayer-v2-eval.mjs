import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { summarize } from "../eval/tiny-decision/metrics.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((s) => {
    const i = s.indexOf("=");
    return [s.slice(2, i), s.slice(i + 1)];
  }),
);
if (!args.jobs || !args.output)
  throw new Error(
    "--jobs=path --output=path required; optional --cache=previous-v2-report.json",
  );
const sha = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
const python = resolve(args.python || ".tmp/slayer-venv/Scripts/python.exe");
const modelId = "SlayerLab/Slayer-149M-Decision-v1";
const modelRevision = "ccfd7d3d91f3894beb1cd096b5d067333ba3d4c7";
const run = (command, parameters) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, parameters, {
      stdio: "inherit",
      shell: false,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
  });
await mkdir(dirname(args.output), { recursive: true });
const work = resolve(".tmp/slayer-v2", sha(args.output).slice(0, 16));
await mkdir(work, { recursive: true });
const budgeted = `${work}/budgeted-jobs.json`,
  budgetPath = args.output.replace(/\.json$/, "-budget.json");
await run(python, [
  "eval/tiny-decision/v2/slayer/select_jobs.py",
  "--jobs",
  args.jobs,
  "--output",
  budgeted,
  "--audit",
  budgetPath,
]);
const prepared = JSON.parse(await readFile(budgeted, "utf8"));
const implementationSha256 = sha(
  (await readFile("eval/tiny-decision/slayer/run.py", "utf8")) +
    (await readFile("eval/tiny-decision/slayer/scoring.py", "utf8")),
);
const key = (job) =>
  sha({
    id: job.id,
    template: job.template,
    prompt: job.prompt,
    indexBase: job.indexBase,
    optionIds: job.options.map((x) => x.id),
    implementationSha256,
    revision: modelRevision,
  });
let cache;
if (args.cache) {
  cache = JSON.parse(await readFile(args.cache, "utf8"));
  if (
    !cache.finishedAt ||
    cache.implementationSha256 !== implementationSha256 ||
    cache.model !== modelId ||
    cache.revision !== modelRevision
  )
    throw new Error("Incomplete or incompatible v2 cache");
}
const known = new Map(
  (cache?.rows || []).map((row) => [row.inferenceKey, row]),
);
const pending = prepared.cases.filter((job) => !known.has(key(job)));
const pendingFile = `${work}/pending-jobs.json`,
  rawFile = `${work}/raw-inference.json`;
let raw;
if (pending.length) {
  await writeFile(
    pendingFile,
    JSON.stringify({ ...prepared, cases: pending }, null, 2) + "\n",
  );
  await run(python, [
    "eval/tiny-decision/slayer/run.py",
    "--jobs",
    pendingFile,
    "--output",
    rawFile,
    "--threads",
    args.threads || "4",
    "--label",
    "v2 template development/frozen evaluation; tokenizer-budgeted inputs",
  ]);
  raw = JSON.parse(await readFile(rawFile, "utf8"));
  if (!raw.finishedAt || raw.rows.length !== pending.length)
    throw new Error("Incomplete native run");
  for (let i = 0; i < pending.length; i++) {
    if (
      raw.rows[i].id !== pending[i].id ||
      raw.rows[i].template !== pending[i].template
    )
      throw new Error("Native output job order/identity mismatch");
    known.set(key(pending[i]), {
      ...raw.rows[i],
      inferenceKey: key(pending[i]),
    });
  }
}
const rows = prepared.cases.map((job) => {
  const result = known.get(key(job));
  if (!result) throw new Error("Missing model result");
  if (
    result.optionIds &&
    JSON.stringify(result.optionIds) !==
      JSON.stringify(job.options.map((x) => x.id))
  )
    throw new Error("Option mismatch");
  const reused = !!cache?.rows.some((row) => row.inferenceKey === key(job));
  const valid =
    !!result.valid &&
    !result.error &&
    job.options.some((x) => x.id === result.chosenId);
  return {
    ...result,
    id: job.id,
    field: job.field,
    split: job.split,
    expectedId: job.expectedId,
    acceptedIds: job.acceptedIds,
    valid,
    correct: valid && job.acceptedIds.includes(result.chosenId),
    budget: job.budget,
    chosenTextLimit: job.chosenTextLimit,
    inferenceKey: key(job),
    reused,
    originalInferenceReport: reused ? args.cache : rawFile,
  };
});
const report = {
  ...raw,
  ...(!raw ? cache : {}),
  schemaVersion: 2,
  label: "Token-budgeted v2 decision templates",
  implementationSha256,
  sourceJobs: args.jobs,
  sourceJobsSha256: sha(await readFile(args.jobs, "utf8")),
  budgetedJobsSha256: sha(prepared),
  budgetAudit: budgetPath,
  inferenceConfiguration: {
    contextTokens: 2048,
    indexBases: [...new Set(prepared.cases.map((job) => job.indexBase))],
    promptFrame:
      "Direct instructions and numeric bracket prefill; no chat wrapper",
    budgetPolicy: prepared.budgetPolicy,
  },
  sampling: prepared.sampling,
  templates: prepared.templates,
  rows,
  finishedAt: new Date().toISOString(),
  reuse: {
    reused: rows.filter((r) => r.reused).length,
    newlyInferred: pending.length,
    source: args.cache || null,
    policy:
      "Reuse only identical case/template/prompt/ordered-option IDs/index base and pinned model/scorer implementation. Reused latency remains its original observation.",
  },
  summaries: [...new Set(rows.map((r) => r.template))].map((template) => {
    const subset = rows.filter((r) => r.template === template);
    return {
      template,
      summary: summarize(subset),
      fields: Object.fromEntries(
        ["title", "image", "description"].map((field) => [
          field,
          summarize(subset.filter((r) => r.field === field)),
        ]),
      ),
    };
  }),
};
await writeFile(args.output, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    output: args.output,
    reuse: report.reuse,
    summaries: report.summaries,
  }),
);
