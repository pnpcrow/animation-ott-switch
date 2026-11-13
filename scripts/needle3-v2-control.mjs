import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { requestFor } from "../eval/tiny-decision/needle3/templates.mjs";
import { diagnosticSummary } from "../eval/tiny-decision/v2/needle/diagnostics.mjs";
import { summarize } from "../eval/tiny-decision/metrics.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const i = arg.indexOf("=");
    return [arg.slice(2, i), arg.slice(i + 1)];
  }),
);
if (!args.selection || !args.holdout || !args.output)
  throw new Error(
    "--selection=development.json --holdout=inputs.json --output=control.json required",
  );
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const selectionBytes = await readFile(args.selection);
const selection = JSON.parse(selectionBytes);
if (!selection.finishedAt || !selection.selection?.template || selection.error)
  throw new Error(
    "Completed, locked development selection required before reading fresh data",
  );

// This policy is declared before reading any fresh cases or predictions.
const policy =
  "Frozen input order: first positive and first explicit none per title/image/description. Six matched cases; labels only stratify/score, never enter model payloads. No predictions used in sampling.";
const inputBytes = await readFile(args.holdout);
const labelsPath =
  args["holdout-labels"] ||
  args.holdout.replace(/-inputs\.json$/, "-labels.json");
if (labelsPath === args.holdout)
  throw new Error("Separate labels path required");
const labelBytes = await readFile(labelsPath);
const inputData = JSON.parse(inputBytes);
const labelData = JSON.parse(labelBytes);
const labels = new Map(
  (Array.isArray(labelData) ? labelData : labelData.cases).map((row) => [
    row.id,
    row,
  ]),
);
const cases = (Array.isArray(inputData) ? inputData : inputData.cases).map(
  (row) => {
    const label = labels.get(row.id);
    if (!label?.expectedId) throw new Error(`Missing label for ${row.id}`);
    return {
      ...row,
      expectedId: label.expectedId,
      acceptedIds: label.acceptedIds,
      split: "holdout",
    };
  },
);
const selected = [];
for (const field of ["title", "image", "description"])
  for (const none of [false, true]) {
    const row = cases.find(
      (item) =>
        item.field === field && (item.expectedId === "__none__") === none,
    );
    if (!row) throw new Error(`Missing control stratum ${field}/${none}`);
    selected.push(row);
  }
const output = resolve(args.output);
const datasetPath = resolve(
  `.tmp/needle3-v2-control-${sha(inputBytes).slice(0, 12)}.json`,
);
await mkdir(dirname(output), { recursive: true });
await mkdir(dirname(datasetPath), { recursive: true });
await writeFile(
  datasetPath,
  JSON.stringify({ cases: selected }, null, 2) + "\n",
);
const protocol = {
  policy,
  lockedAt: new Date().toISOString(),
  selectionFile: args.selection,
  selectionSha256: sha(selectionBytes),
  selectedTemplate: selection.selection.template,
  inputSha256: sha(inputBytes),
  labelsSha256: sha(labelBytes),
  selectedIds: selected.map((row) => row.id),
  controlTemplate: "tool-routing",
  controlTemplateSha256: sha(
    await readFile("eval/tiny-decision/needle3/templates.mjs"),
  ),
  runnerSha256: sha(await readFile("scripts/needle3-eval.mjs")),
  automaticNavigation: false,
};
await writeFile(
  output.replace(/\.json$/, "-protocol.json"),
  JSON.stringify(protocol, null, 2) + "\n",
);
const status = await new Promise((resolveStatus, reject) => {
  const child = spawn(
    process.execPath,
    [
      "scripts/needle3-eval.mjs",
      `--dataset=${datasetPath}`,
      "--template=tool-routing",
      "--split=holdout",
      `--output=${output}`,
    ],
    { stdio: "inherit" },
  );
  child.on("error", reject);
  child.on("exit", resolveStatus);
});
if (status !== 0) throw new Error(`v1 control failed with exit ${status}`);
const report = JSON.parse(await readFile(output, "utf8"));
if (!report.finishedAt) throw new Error("v1 control did not finish");
const byId = new Map(selected.map((row) => [row.id, row]));
for (const run of report.runs) {
  for (const row of run.rows) {
    const item = byId.get(row.id);
    const request = requestFor(
      {
        document: item.document,
        question: item.question,
        options: item.options,
      },
      "tool-routing",
    );
    const serialized = JSON.stringify(request);
    const nativeStrings = JSON.stringify(request.tools) + request.input;
    row.request = request;
    row.inputSize = {
      chars: [...nativeStrings].length,
      utf8Bytes: Buffer.byteLength(nativeStrings),
      toolChars: [...JSON.stringify(request.tools)].length,
      inputChars: [...request.input].length,
      textTier: "v1-unbounded",
    };
    row.payloadSha256 = sha(serialized);
  }
  run.diagnostics = diagnosticSummary(run.rows);
}
report.controlProtocol = protocol;
if (args.comparison) {
  const comparison = JSON.parse(await readFile(args.comparison, "utf8"));
  if (!comparison.finishedAt || comparison.error)
    throw new Error("Completed v2 holdout comparison required");
  if (
    comparison.holdoutSha256 !==
    sha(JSON.stringify({ inputs: inputData, labels: labelData }))
  )
    throw new Error(
      "Matched comparison used different holdout inputs or labels",
    );
  const selectedIds = new Set(protocol.selectedIds);
  const run = comparison.runs.find(
    (candidate) => candidate.template === protocol.selectedTemplate,
  );
  if (!run) throw new Error("Matching selected v2 template missing");
  const rows = run.rows.filter((row) => selectedIds.has(row.id));
  if (rows.length !== selected.length)
    throw new Error("Matched v2 subset incomplete");
  report.matchedV2 = {
    source: args.comparison,
    template: run.template,
    selectedIds: protocol.selectedIds,
    summary: summarize(rows),
    diagnostics: diagnosticSummary(rows),
  };
}
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    control: report.runs.map((run) => ({
      template: run.template,
      summary: run.summary,
      diagnostics: run.diagnostics,
    })),
    matchedV2: report.matchedV2,
  }),
);
