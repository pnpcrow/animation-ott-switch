import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const paths = {
  jev: "eval/tiny-decision/v2/reports/jev-selection.json",
  slayer: "eval/tiny-decision/v2/slayer/selection.json",
  slayerPointwise: "eval/tiny-decision/v2/slayer/pointwise-pilot.json",
  needle: "eval/tiny-decision/v2/needle/reports/development-summary.json",
};
const selections = {};
for (const [name, path] of Object.entries(paths)) {
  const bytes = await readFile(path);
  const report = JSON.parse(bytes);
  const lockedAt = report.lockedAt || report.selectedAt || report.selection?.lockedAt;
  if (name !== "slayerPointwise" && !lockedAt) throw new Error(`${name} has no locked development selection`);
  selections[name] = { path, sha256: digest(bytes), lockedAt: lockedAt || null };
}
const sources = {};
for (const path of [
  "eval/tiny-decision/v2/features.mjs",
  "eval/tiny-decision/v2/templates.mjs",
  "eval/tiny-decision/v2/refined.mjs",
  "eval/tiny-decision/v2/needle/templates.mjs",
  "eval/tiny-decision/v2/slayer/pointwise.mjs",
  "eval/tiny-decision/baseline.mjs",
  "eval/tiny-decision/v2/data/development-inputs.json",
  "eval/tiny-decision/v2/data/development-labels.json",
  "eval/tiny-decision/v2/data/holdout-inputs.json",
  "eval/tiny-decision/v2/data/holdout-labels.json",
]) sources[path] = digest(await readFile(path));
const record = {
  schemaVersion: 2,
  lockedAt: new Date().toISOString(),
  selections,
  sources,
  protocol: "All development choices are fixed before opening fresh candidate inputs, labels, annotations, or predictions. Source URL references are visible in dataset documentation. No fresh-driven template, threshold, or candidate tuning. Holdout hashes were computed without parsing content. Existing lock is never overwritten.",
  jevValidation: "Selected v2 and legacy-enriched on all 18 fresh cases; unchanged v1 dom-hierarchy on the same 18; selected v2 on a full reverse permutation of all 18. Reversed cases are dependent diagnostics, not new examples.",
  slayerValidation: "Selected v2 and legacy-enriched on all 18 fresh cases; unchanged v1 korean-structure on the same 18. Pointwise failed its development gate and is not promoted.",
  needleValidation: "Selected v2 on all 18 fresh cases; unchanged v1 tool-routing on the first positive and first none case per field (six matched cases), chosen by frozen input order before predictions.",
  baseline: "Apply the unchanged v1 compact generic DOM rules to the new 18 cases, with no v2 rule tuning.",
  automaticNavigation: false,
};
await writeFile("eval/tiny-decision/v2/global-freeze.json", JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ lockedAt: record.lockedAt, selections }));
