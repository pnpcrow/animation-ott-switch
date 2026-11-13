import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = "eval/light-dom/", hash = b => createHash("sha256").update(b).digest("hex");
const selections = {};
for (const [name, path] of Object.entries({ nli: "nli/selection.json", kure: "reports/kure-selection.json", jina: "jina/selection.json" })) {
  const bytes = await readFile(root + path), selection = JSON.parse(bytes);
  if (!selection.lockedAt || !selection.selected) throw new Error(`Missing selection: ${name}`);
  selections[name] = { path: root + path, sha256: hash(bytes), template: selection.selected.template, threshold: selection.selected.threshold, modelSha256: selection.modelSha256 };
}
const structural = JSON.parse(await readFile(root + "reports/structural-development.json", "utf8"));
if (!structural.lockedAt) throw new Error("Structural model selection required");
const sources = {};
for (const path of [
  root + "templates.mjs", root + "selection.mjs", root + "structural.mjs", root + "structural-model.json", root + "reports/structural-development.json",
  root + "data/development-inputs.json", root + "data/development-labels.json", root + "data/holdout-inputs.json", root + "data/holdout-labels.json",
  "eval/tiny-decision/v2/features.mjs", "eval/tiny-decision/baseline.mjs",
]) sources[path] = hash(await readFile(path));
const model = JSON.parse(await readFile(root + "structural-model.json", "utf8"));
if (model.provenance.featureSourceSha256 !== sources[root + "structural.mjs"]) throw new Error("Structural feature source changed after training");
const record = {
  schemaVersion: 1, lockedAt: new Date().toISOString(), selections, sources,
  protocol: "All model choices, scalar thresholds, templates, features and trained weights are fixed before opening new candidate inputs/labels/annotations or predictions. Existing 66 cases are development only. No fresh-driven tuning.",
  evaluations: "Selected neural template and global threshold per model on all 18 new cases. Structural ranker and unchanged compact generic rules on the same cases. Report 18 total and 17 nontrivial cases; one image case has no observed candidate. Native quantized outputs, browser runtime compatibility/performance and node-ID choices remain distinct metrics.",
  browserProtocol: "One selected-template pass over all nonempty fresh cases per quantized neural model in a working browser provider, paired to native output. Development six-case diagnostics across title/image/description and positive/none for provider and warm timing checks. Browser jobs are pretokenized; memory excludes Python tokenizer. Structural browser times include observed-evidence feature construction and ranking, exclude live DOM collection.",
  deployment: "Research only; no model dependency or automatic model download added to extension. Preferred model weight artifact <=200,000,000 bytes, native/browser memory measured separately. No claim that this file-size budget bounds runtime RAM.",
  automaticNavigation: false,
};
await writeFile(root + "freeze.json", JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ lockedAt: record.lockedAt, selections }));
