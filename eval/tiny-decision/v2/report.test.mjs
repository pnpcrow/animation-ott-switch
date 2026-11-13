import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, join, dirname } from "node:path";
const run = promisify(execFile);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const script = resolve("scripts/report-v2-jev.mjs");
const prefix = "eval/tiny-decision/v2/";

async function fixture() {
  const base = resolve(".tmp/v2-contract-audit");
  await mkdir(base, { recursive: true });
  const cwd = await mkdtemp(join(base, "report-"));
  const put = async (path, value) => {
    await mkdir(dirname(join(cwd, path)), { recursive: true });
    const text = JSON.stringify(value);
    await writeFile(join(cwd, path), text);
    return sha(text);
  };
  const inputs = [
    {
      id: "fixture-title",
      split: "holdout",
      field: "title",
      document:
        "URL: https://example.test/work/one\nDocument title: Observed work",
      options: [
        { id: "t1", text: 'value="Observed work"; main>h1 @text visible' },
        { id: "__none__", text: "None" },
      ],
    },
    {
      id: "fixture-absent",
      split: "holdout",
      field: "description",
      document: "URL: https://example.test/search\nDocument title: Search",
      options: [
        {
          id: "d1",
          text: 'value="Subscribe to watch thousands of shows"; head>meta @description head-metadata',
        },
        { id: "__none__", text: "None" },
      ],
    },
  ];
  const labels = inputs.map((row) => ({
    id: row.id,
    expectedId: row.field === "title" ? "t1" : "__none__",
  }));
  const template = "field-rubric";
  const prediction = (row, template, reverse = false) => ({
    id: row.id + (reverse ? "::reverse" : ""),
    template,
    valid: true,
    chosenId: labels.find((l) => l.id === row.id).expectedId,
    correct: true,
    optionIds: (reverse ? [...row.options].reverse() : row.options).map(
      (o) => o.id,
    ),
    elapsedMs: 1,
  });
  const results = inputs.flatMap((row) => [
    prediction(row, template),
    prediction(row, "legacy-enriched"),
    prediction(row, template, true),
  ]);
  const report = (rows) => ({
    model: "fixture-model",
    revision: "fixture-revision",
    finishedAt: "2026-01-02T00:00:00Z",
    results: rows,
  });
  const sourceHashes = {};
  sourceHashes[prefix + "data/holdout-inputs.json"] = await put(
    prefix + "data/holdout-inputs.json",
    inputs,
  );
  sourceHashes[prefix + "data/holdout-labels.json"] = await put(
    prefix + "data/holdout-labels.json",
    labels,
  );
  const baselinePath = "eval/tiny-decision/baseline.mjs";
  const baseline = await readFile(resolve(baselinePath));
  await writeFile(join(cwd, baselinePath), baseline);
  sourceHashes[baselinePath] = sha(baseline);
  const selectionPath = prefix + "reports/jev-selection.json";
  const selectionHash = await put(selectionPath, {
    selectedTemplates: [template],
  });
  await put(prefix + "global-freeze.json", {
    lockedAt: "2026-01-01T00:00:00Z",
    sources: sourceHashes,
    selections: { jev: { path: selectionPath, sha256: selectionHash } },
  });
  await put(prefix + "reports/jev-validation.json", report(results));
  await put(
    prefix + "reports/jev-v1-fresh.json",
    report(inputs.map((row) => prediction(row, "dom-hierarchy"))),
  );
  return {
    cwd,
    put,
    results,
    report,
    invoke: () => run(process.execPath, [script], { cwd, windowsHide: true }),
  };
}

test("comparison reports verify frozen sources and complete original/reverse conditions", async () => {
  const h = await fixture();
  await h.invoke();
  const report = JSON.parse(
    await readFile(join(h.cwd, prefix + "reports/jev-comparison.json"), "utf8"),
  );
  assert.equal(report.groups.selected.summary.attempted, 2);
  assert.equal(report.groups.selected.summary.correct, 2);
  assert.equal(report.comparisons.originalToReverse.sameChoice, 2);
  assert.ok(report.sourceHashes["global-freeze.json"]);
  assert.ok(report.sourceHashes["data/holdout-labels.json"]);
});

test("report generation rejects changed frozen input and changed locked selection", async () => {
  const changedInput = await fixture();
  await changedInput.put(prefix + "data/holdout-inputs.json", []);
  await assert.rejects(changedInput.invoke, /Frozen source changed/);
  const changedSelection = await fixture();
  await changedSelection.put(prefix + "reports/jev-selection.json", {
    selectedTemplates: ["legacy-enriched"],
  });
  await assert.rejects(
    changedSelection.invoke,
    /Jev selection changed after freeze/,
  );
});

test("report generation rejects duplicate or unexpected validation conditions instead of filtering them away", async () => {
  const duplicate = await fixture();
  await duplicate.put(
    prefix + "reports/jev-validation.json",
    duplicate.report([...duplicate.results, duplicate.results[0]]),
  );
  await assert.rejects(
    duplicate.invoke,
    /Unexpected or incomplete frozen validation conditions/,
  );
  const wrongTemplate = await fixture();
  await wrongTemplate.put(
    prefix + "reports/jev-validation.json",
    wrongTemplate.report(
      wrongTemplate.results.map((r, i) =>
        i === 0 ? { ...r, template: "not-frozen" } : r,
      ),
    ),
  );
  await assert.rejects(
    wrongTemplate.invoke,
    /Unexpected or incomplete frozen validation conditions/,
  );
});
