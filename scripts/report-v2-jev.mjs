import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { chooseCompactHeuristic } from "../eval/tiny-decision/baseline.mjs";
import {
  scorePinned,
  pairedOutcomes,
} from "../eval/tiny-decision/v2/analysis.mjs";
const root = "eval/tiny-decision/v2/";
const json = async (path) => JSON.parse(await readFile(root + path, "utf8"));
const freeze = await json("global-freeze.json");
if (!freeze.lockedAt) throw new Error("Global development freeze required");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
if (
  !freeze.sources ||
  !Object.keys(freeze.sources).length ||
  !freeze.selections?.jev?.sha256
)
  throw new Error("Frozen source and selection hashes required");
for (const [path, expected] of Object.entries(freeze.sources)) {
  if (digest(await readFile(path)) !== expected)
    throw new Error(`Frozen source changed: ${path}`);
}
const selectionBytes = await readFile(freeze.selections.jev.path);
if (digest(selectionBytes) !== freeze.selections.jev.sha256)
  throw new Error("Jev selection changed after freeze");
const selection = JSON.parse(selectionBytes),
  template = selection.selectedTemplates[0];
const inputs = await json("data/holdout-inputs.json"),
  labels = await json("data/holdout-labels.json");
const byId = new Map(labels.map((row) => [row.id, row]));
if (byId.size !== labels.length || labels.length !== inputs.length)
  throw new Error("Scoring labels must cover unique input IDs");
const corpus = inputs.map((input) => {
  const label = byId.get(input.id);
  if (!label?.expectedId) throw new Error("Missing frozen scoring label");
  return {
    ...input,
    expectedId: label.expectedId,
    acceptedIds: label.acceptedIds || [label.expectedId],
  };
});
const fresh = await json("reports/jev-validation.json"),
  legacy = await json("reports/jev-v1-fresh.json");
if (!fresh.finishedAt || !legacy.finishedAt || fresh.error || legacy.error)
  throw new Error("Completed runs required");
if (fresh.model !== legacy.model || fresh.revision !== legacy.revision)
  throw new Error("Comparison model or revision differs");
const expectedFresh = new Set(
  corpus.flatMap((row) => [
    `${template}|${row.id}`,
    ...(template === "legacy-enriched" ? [] : [`legacy-enriched|${row.id}`]),
    `${template}|${row.id}::reverse`,
  ]),
);
const observedFresh = fresh.results.map((row) => `${row.template}|${row.id}`);
if (
  observedFresh.length !== expectedFresh.size ||
  new Set(observedFresh).size !== observedFresh.length ||
  observedFresh.some((key) => !expectedFresh.has(key))
)
  throw new Error("Unexpected or incomplete frozen validation conditions");
if (legacy.results.some((row) => row.template !== "dom-hierarchy"))
  throw new Error("Unexpected v1 comparison template");
const selected = scorePinned(
  corpus,
  fresh.results.filter(
    (r) => r.template === template && !r.id.endsWith("::reverse"),
  ),
);
const enriched = scorePinned(
  corpus,
  fresh.results.filter(
    (r) => r.template === "legacy-enriched" && !r.id.endsWith("::reverse"),
  ),
);
const reversed = scorePinned(
  corpus,
  fresh.results
    .filter((r) => r.id.endsWith("::reverse"))
    .map((r) => ({ ...r, id: r.id.slice(0, -9) })),
);
const unchanged = scorePinned(corpus, legacy.results);
const baselineRows = corpus.map((row) => {
  const start = performance.now();
  const chosenId = chooseCompactHeuristic(row);
  return {
    id: row.id,
    chosenId,
    valid: true,
    elapsedMs: performance.now() - start,
  };
});
const baseline = scorePinned(corpus, baselineRows);
const report = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  template,
  globalFreezeAt: freeze.lockedAt,
  groups: { unchanged, enriched, selected, reversed, baseline },
  comparisons: {
    unchangedToSelected: pairedOutcomes(unchanged, selected),
    enrichedToSelected: pairedOutcomes(enriched, selected),
    originalToReverse: pairedOutcomes(selected, reversed),
  },
  baseline: {
    rulesSha256: createHash("sha256")
      .update(await readFile("eval/tiny-decision/baseline.mjs"))
      .digest("hex"),
    information:
      "Unmodified v1 generic compact-input rules on the same new cases; no v2 rule fitting.",
  },
  sourceHashes: Object.fromEntries(
    await Promise.all(
      [
        "global-freeze.json",
        "data/holdout-inputs.json",
        "data/holdout-labels.json",
        "reports/jev-validation.json",
        "reports/jev-v1-fresh.json",
        "reports/jev-selection.json",
      ].map(async (path) => [path, digest(await readFile(root + path))]),
    ),
  ),
};
await writeFile(
  root + "reports/jev-comparison.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    groups: Object.fromEntries(
      Object.entries(report.groups).map(([name, r]) => [
        name,
        { summary: r.summary, target: r.target, fields: r.fields },
      ]),
    ),
    comparisons: report.comparisons,
  }),
);
