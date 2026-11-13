import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { chooseCompactHeuristic } from "../eval/tiny-decision/baseline.mjs";
import { scorePinned, pairedOutcomes } from "../eval/tiny-decision/v2/analysis.mjs";
const root = "eval/tiny-decision/v2/";
const json = async path => JSON.parse(await readFile(root + path, "utf8"));
const freeze = await json("global-freeze.json");
if (!freeze.lockedAt) throw new Error("Global development freeze required");
const inputs = await json("data/holdout-inputs.json"), labels = await json("data/holdout-labels.json");
const byId = new Map(labels.map(row => [row.id, row]));
const corpus = inputs.map(row => ({ ...row, ...byId.get(row.id) }));
const fresh = await json("reports/jev-validation.json"), legacy = await json("reports/jev-v1-fresh.json");
if (!fresh.finishedAt || !legacy.finishedAt) throw new Error("Completed runs required");
const selection = await json("reports/jev-selection.json"), template = selection.selectedTemplates[0];
const selected = scorePinned(corpus, fresh.results.filter(r => r.template === template && !r.id.endsWith("::reverse")));
const enriched = scorePinned(corpus, fresh.results.filter(r => r.template === "legacy-enriched" && !r.id.endsWith("::reverse")));
const reversed = scorePinned(corpus, fresh.results.filter(r => r.id.endsWith("::reverse")).map(r => ({ ...r, id: r.id.slice(0, -9) })));
const unchanged = scorePinned(corpus, legacy.results);
const baselineRows = corpus.map(row => {
  const start = performance.now();
  const chosenId = chooseCompactHeuristic(row);
  return { id: row.id, chosenId, valid: true, elapsedMs: performance.now() - start };
});
const baseline = scorePinned(corpus, baselineRows);
const report = {
  schemaVersion: 2, generatedAt: new Date().toISOString(), template, globalFreezeAt: freeze.lockedAt,
  groups: { unchanged, enriched, selected, reversed, baseline },
  comparisons: { unchangedToSelected: pairedOutcomes(unchanged, selected), enrichedToSelected: pairedOutcomes(enriched, selected), originalToReverse: pairedOutcomes(selected, reversed) },
  baseline: { rulesSha256: createHash("sha256").update(await readFile("eval/tiny-decision/baseline.mjs")).digest("hex"), information: "Unmodified v1 generic compact-input rules on the same new cases; no v2 rule fitting." },
  sourceHashes: Object.fromEntries(await Promise.all(["reports/jev-validation.json", "reports/jev-v1-fresh.json", "reports/jev-selection.json"].map(async path => [path, createHash("sha256").update(await readFile(root + path)).digest("hex")]))),
};
await writeFile(root + "reports/jev-comparison.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ groups: Object.fromEntries(Object.entries(report.groups).map(([name, r]) => [name, { summary: r.summary, target: r.target, fields: r.fields }])), comparisons: report.comparisons }));
