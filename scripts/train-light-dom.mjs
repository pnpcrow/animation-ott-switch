import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { featureNames, encodeDataset, fit, predictEncoded } from "../eval/light-dom/structural.mjs";
import { summarize } from "../eval/tiny-decision/metrics.mjs";
const root = "eval/light-dom/";
const inputBytes = await readFile(root + "data/development-inputs.json"), labelBytes = await readFile(root + "data/development-labels.json");
const inputs = JSON.parse(inputBytes), labels = JSON.parse(labelBytes);
const names = featureNames(inputs[0]), rows = encodeDataset(inputs, labels, names);
const groups = [...new Set(rows.map(r => r.group))].sort();
if (groups.includes(undefined)) throw new Error("Every development case needs a work group");
const folds = 5;
const byGroup = new Map(groups.map((group, i) => [group, i % folds]));
const candidates = [];
for (const lambda of [0.001, 0.01, 0.1]) {
  const predictions = [];
  for (let fold = 0; fold < folds; fold++) {
    const train = rows.filter(r => byGroup.get(r.group) !== fold), test = rows.filter(r => byGroup.get(r.group) === fold);
    const model = fit(train, names, { lambda });
    predictions.push(...test.map(row => ({ ...predictEncoded(model, row), fold })));
  }
  candidates.push({ lambda, summary: summarize(predictions), predictions });
}
candidates.sort((a, b) => b.summary.correct - a.summary.correct || a.summary.falseSelections - b.summary.falseSelections || b.lambda - a.lambda);
const model = fit(rows, names, { lambda: candidates[0].lambda });
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
model.provenance = { trainedAt: new Date().toISOString(), inputSha256: digest(inputBytes), labelSha256: digest(labelBytes), featureSourceSha256: digest(await readFile(root + "structural.mjs")), trainingCases: rows.length, workOrPageGroups: groups.length };
const report = { model: model.model, selectedLambda: model.lambda, lockedAt: model.provenance.trainedAt, selectionPolicy: "Five folds grouped by work, fixed sorted group modulo assignment; most correct, fewer false selections, stronger regularization. No fresh data.", folds: Object.fromEntries(byGroup), candidates, resubstitution: summarize(rows.map(row => predictEncoded(model, row))), automaticNavigation: false };
await mkdir(root + "reports", { recursive: true });
await writeFile(root + "structural-model.json", JSON.stringify(model) + "\n");
await writeFile(root + "reports/structural-development.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ features: names.length, bytes: Buffer.byteLength(JSON.stringify(model) + "\n"), candidates: candidates.map(c => ({ lambda: c.lambda, summary: c.summary })), resubstitution: report.resubstitution }));
