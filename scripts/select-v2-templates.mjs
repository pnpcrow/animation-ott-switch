import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { summarize, hash } from "../eval/tiny-decision/metrics.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((s) => {
    const i = s.indexOf("=");
    return [s.slice(2, i), s.slice(i + 1)];
  }),
);
if (!args.reports || !args.output)
  throw new Error(
    "--reports and --output required; --expected=frozen-jobs.json for unsampled runs",
  );
const count = Number(args.count || 1);
if (!Number.isInteger(count) || count < 1)
  throw new Error("--count must be a positive integer");
const reports = await Promise.all(
  args.reports.split(",").map(async (path) => ({
    path,
    data: JSON.parse(await readFile(path, "utf8")),
  })),
);
if (reports.some((r) => !r.data.finishedAt || r.data.error))
  throw new Error("Completed development reports only");
for (const key of ["model", "revision", "inputsSha256", "labelsSha256"]) {
  const values = new Set(reports.map((r) => r.data[key]).filter(Boolean));
  if (values.size > 1)
    throw new Error(`Development reports disagree on ${key}`);
}
const sortedUnique = (ids, context) => {
  if (!ids.length || ids.some((id) => typeof id !== "string" || !id))
    throw new Error(`Missing planned IDs: ${context}`);
  if (new Set(ids).size !== ids.length)
    throw new Error(`Duplicate planned IDs: ${context}`);
  return [...ids].sort();
};
const equalIds = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let expectedJobs;
if (args.expected) {
  expectedJobs = JSON.parse(await readFile(args.expected, "utf8"));
  if (!Array.isArray(expectedJobs.cases) || !expectedJobs.cases.length)
    throw new Error("Expected jobs must contain planned cases");
  if (expectedJobs.cases.some((r) => r.split !== "development"))
    throw new Error("Expected jobs must be development only");
}
const planned = new Map();
if (expectedJobs) {
  for (const row of expectedJobs.cases) {
    if (typeof row.template !== "string" || !row.template)
      throw new Error("Expected jobs need a template for every case");
    const ids = planned.get(row.template) || [];
    ids.push(row.id);
    planned.set(row.template, ids);
  }
  for (const [template, ids] of planned)
    planned.set(template, sortedUnique(ids, template));
}
const groups = new Map();
for (const { data } of reports) {
  const predictions = data.results || data.rows;
  if (!Array.isArray(predictions) || !predictions.length)
    throw new Error("Completed report has no predictions");
  const reportTemplates = [...new Set(predictions.map((r) => r.template))];
  if (!expectedJobs) {
    const ids = sortedUnique(
      data.sampling?.selectedIds || [],
      "report sampling",
    );
    for (const template of reportTemplates) {
      const actualIds = sortedUnique(
        predictions.filter((r) => r.template === template).map((r) => r.id),
        `reported ${template}`,
      );
      if (!equalIds(actualIds, ids))
        throw new Error(`Incomplete planned development coverage: ${template}`);
      if (planned.has(template) && !equalIds(planned.get(template), ids))
        throw new Error(`Conflicting development sampling plans: ${template}`);
      planned.set(template, ids);
    }
  }
  for (const row of predictions) {
    if (row.split !== "development")
      throw new Error("No validation data allowed in template selection");
    if (typeof row.template !== "string" || !row.template)
      throw new Error("Prediction has no template");
    const rows = groups.get(row.template) || [];
    rows.push(row);
    groups.set(row.template, rows);
  }
}
if (!equalIds([...groups.keys()].sort(), [...planned.keys()].sort()))
  throw new Error(
    "Reports must cover every planned template and no extra template",
  );
const candidates = [...groups].map(([template, rows]) => {
  if (new Set(rows.map((r) => r.id)).size !== rows.length)
    throw new Error("Duplicate development prediction");
  const ids = rows.map((r) => r.id).sort();
  if (!equalIds(ids, planned.get(template)))
    throw new Error(`Incomplete planned development coverage: ${template}`);
  return {
    template,
    ids,
    summary: summarize(rows),
    positiveCorrect: rows.filter(
      (r) => r.correct && r.expectedId !== "__none__",
    ).length,
  };
});
if (new Set(candidates.map((x) => JSON.stringify(x.ids))).size !== 1)
  throw new Error("Templates must share the same planned development cases");
if (count > candidates.length)
  throw new Error("--count exceeds the number of evaluated templates");
candidates.sort(
  (a, b) =>
    b.summary.accuracy - a.summary.accuracy ||
    a.summary.falseSelections - b.summary.falseSelections ||
    b.summary.valid - a.summary.valid ||
    a.template.localeCompare(b.template),
);
const selection = {
  schemaVersion: 2,
  stage: args.stage || "screen",
  lockedAt: new Date().toISOString(),
  policy:
    "Accuracy, fewer false selections, more valid outputs, stable template ID; no latency tie break",
  selectedTemplates: candidates.slice(0, count).map((x) => x.template),
  candidates,
  sources: reports.map((r) => ({ path: r.path, hash: hash(r.data) })),
  validation: {
    coverage:
      "Every planned template/ID pair is present exactly once; failures remain in the denominator",
    source: expectedJobs ? "explicit-expected-jobs" : "report-sampling",
    expectedJobsSha256: expectedJobs ? hash(expectedJobs) : null,
    plannedIdsByTemplate: Object.fromEntries(planned),
  },
  automaticNavigation: false,
};
// Same decision/source evidence may be replayed; existing decisions cannot be overwritten.
// An older lock may gain a coverage audit without changing its decision or timestamp.
const lockIdentity = (value) => ({
  schemaVersion: value.schemaVersion,
  stage: value.stage,
  policy: value.policy,
  selectedTemplates: value.selectedTemplates,
  candidates: value.candidates,
  sourceHashes: (value.sources || []).map((s) => s.hash).sort(),
  automaticNavigation: value.automaticNavigation,
});
try {
  const previous = JSON.parse(await readFile(args.output, "utf8"));
  if (
    hash(lockIdentity(previous)) !== hash(lockIdentity(selection)) ||
    (previous.validation?.expectedJobsSha256 &&
      previous.validation.expectedJobsSha256 !==
        selection.validation.expectedJobsSha256)
  )
    throw new Error(
      "Existing selection lock differs; choose a separate output path",
    );
  selection.lockedAt = previous.lockedAt;
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await mkdir(dirname(args.output), { recursive: true });
await writeFile(args.output, JSON.stringify(selection, null, 2) + "\n");
console.log(JSON.stringify(selection));
