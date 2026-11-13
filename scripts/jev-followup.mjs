import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import {
  decisionPrompt,
  templates,
  authorDecisionPrompt,
} from "../eval/tiny-decision/templates.mjs";
import {
  summarize,
  selectTemplate,
  hash,
} from "../eval/tiny-decision/metrics.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((x) => x.replace(/^--/, "").split("=")),
);
const calibrationPath =
  args.calibration || "eval/tiny-decision/reports/jev-calibration.json";
const directory = args.output || "eval/tiny-decision/reports";
const started = Date.now();
let calibration;
while (!calibration?.finishedAt) {
  try {
    calibration = JSON.parse(await readFile(calibrationPath, "utf8"));
  } catch (error) {
    if (!args.wait) throw error;
  }
  if (calibration?.finishedAt) break;
  if (!args.wait || Date.now() - started > 90 * 60 * 1000)
    throw new Error("Calibration is incomplete; no template selected");
  await new Promise((resolve) => setTimeout(resolve, 10000));
}
const base = JSON.parse(
  await readFile("eval/tiny-decision/data/dom-selection.json", "utf8"),
);
if (
  calibration.datasetSha256 !== hash(base) ||
  calibration.templateSha256 !== hash(templates)
)
  throw new Error("Calibration does not match the frozen corpus/templates");
const expected = new Set(
  base.filter((r) => r.split === "calibration").map((r) => r.id),
);
const summaries = templates.map((t) => {
  const rows = calibration.results.filter((r) => r.template === t.id);
  if (
    rows.length !== expected.size ||
    new Set(rows.map((r) => r.id)).size !== expected.size ||
    rows.some((r) => !expected.has(r.id) || r.split !== "calibration")
  )
    throw new Error("Incomplete calibration template");
  return { template: t.id, split: "calibration", summary: summarize(rows) };
});
let selection = {
  ...selectTemplate(summaries),
  lockedAt: new Date().toISOString(),
  sourceSha256: hash(calibration),
  summaries,
};
await mkdir(directory, { recursive: true });
try {
  const previous = JSON.parse(
    await readFile(`${directory}/jev-selection.json`, "utf8"),
  );
  if (
    previous.sourceSha256 !== selection.sourceSha256 ||
    previous.template !== selection.template
  )
    throw new Error(
      "Existing selection lock differs; use a separate report directory",
    );
  selection = previous;
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await writeFile(
  `${directory}/jev-selection.json`,
  JSON.stringify(selection, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    selected: selection.template,
    calibration: selection.calibration,
  }),
);
const cohorts = {
  holdout: "dom-selection",
  ablation: "dom-selection-ablation",
  stress: "dom-selection-stress",
  compact: "dom-selection-compact",
  challenge: "synthetic-challenge",
  "author-format": "dom-selection",
};
const cases = [],
  datasets = {};
for (const [cohort, name] of Object.entries(cohorts)) {
  const dataset = JSON.parse(
    await readFile(`eval/tiny-decision/data/${name}.json`, "utf8"),
  );
  datasets[cohort] = hash(dataset);
  for (const row of dataset.filter((r) => r.split === "holdout")) {
    cases.push({
      id: row.id,
      split: row.split,
      scenario: row.scenario,
      cohort,
      template:
        cohort === "author-format"
          ? "author-state-control"
          : selection.template,
      indexBase: 1,
      prompt:
        cohort === "author-format"
          ? authorDecisionPrompt(row)
          : decisionPrompt(row, selection.template),
      options: row.options,
      expectedId: row.expectedId,
      acceptedIds: row.acceptedIds || [row.expectedId],
    });
  }
}
await mkdir(".tmp", { recursive: true });
const jobs = ".tmp/jev-followup-jobs.json";
const output = `${directory}/jev-followup-raw.json`;
await writeFile(
  jobs,
  JSON.stringify(
    {
      schemaVersion: 1,
      templateSha256: hash(
        templates.filter((t) => t.id === selection.template),
      ),
      datasets,
      cases,
    },
    null,
    2,
  ) + "\n",
);
const python = resolve(
  args.python || ".tmp/tiny-decision-venv/Scripts/python.exe",
);
await new Promise((resolve, reject) => {
  const child = spawn(
    python,
    ["eval/tiny-decision/jev/run.py", "--jobs", jobs, "--output", output],
    { stdio: "inherit", shell: false },
  );
  child.on("error", reject);
  child.on("exit", (code) =>
    code === 0 ? resolve() : reject(new Error(`Jev exited with ${code}`)),
  );
});
const raw = JSON.parse(await readFile(output, "utf8"));
for (const cohort of Object.keys(cohorts)) {
  const results = raw.results.filter((r) => r.cohort === cohort);
  const report = {
    ...raw,
    datasetSha256: datasets[cohort],
    cohort,
    cohortNote:
      cohort === "author-format"
        ? "Fixed author-format sensitivity control; not selected by holdout accuracy or counted as new independent data"
        : undefined,
    selection,
    results,
    summary: summarize(results),
  };
  await writeFile(
    `${directory}/jev-${cohort}.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify({ cohort, summary: report.summary }));
}
