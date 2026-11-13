import { readFile, writeFile, mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { chooseCompactHeuristic } from "./baseline.mjs";

// Apply exactly the already frozen compact-input rules; no fitting or rule changes.
const sources = ["dom-selection-stress.json", "dom-selection-compact.json"];
const datasets = await Promise.all(
  sources.map(async (name) =>
    JSON.parse(
      await readFile(new URL(`./data/${name}`, import.meta.url), "utf8"),
    ),
  ),
);
const cases = datasets.flat().filter((row) => row.split === "holdout");
if (cases.length !== 54)
  throw new Error(`Expected 36 stress + 18 compact pairs, got ${cases.length}`);
const report = {
  model: "generic-dom-heuristic-compact",
  runtime: "JavaScript deterministic",
  information:
    "Unmodified frozen compact-input rules applied to dependent stress/compact holdout pairs; not new independent samples",
  sources,
  rulesSha256: createHash("sha256")
    .update(await readFile(new URL("./baseline.mjs", import.meta.url)))
    .digest("hex"),
  results: [],
};
for (const row of cases) {
  const start = performance.now();
  const chosenId = chooseCompactHeuristic({
    document: row.document,
    options: row.options,
    field: row.field,
  });
  report.results.push({
    id: row.id,
    split: row.split,
    field: row.field,
    chosenId,
    expectedId: row.expectedId,
    acceptedIds: row.acceptedIds,
    optionIds: row.options.map((o) => o.id),
    valid: row.options.some((o) => o.id === chosenId),
    correct: row.acceptedIds.includes(chosenId),
    elapsedMs: performance.now() - start,
  });
}
report.finishedAt = new Date().toISOString();
await mkdir(new URL("./reports/", import.meta.url), { recursive: true });
await writeFile(
  new URL("./reports/generic-baseline-controls.json", import.meta.url),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    cases: report.results.length,
    correct: report.results.filter((r) => r.correct).length,
    byTransform: Object.fromEntries(
      ["candidate-permutation", "class-rename", "compact"].map((kind) => {
        const rows = report.results.filter((r) => r.id.endsWith(`::${kind}`));
        return [
          kind,
          { n: rows.length, correct: rows.filter((r) => r.correct).length },
        ];
      }),
    ),
  }),
);
