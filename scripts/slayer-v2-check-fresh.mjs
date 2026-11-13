import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { hash } from "../eval/tiny-decision/metrics.mjs";
import { v2Prompt } from "../eval/tiny-decision/v2/templates.mjs";
import { decisionPrompt } from "../eval/tiny-decision/templates.mjs";

const sources = [];
const read = async (path) => {
  const text = await readFile(path, "utf8");
  sources.push({ path, sha256: hash(text) });
  return JSON.parse(text);
};
const freeze = await read("eval/tiny-decision/v2/global-freeze.json");
assert.ok(freeze.lockedAt, "Global freeze required before reading fresh data");
const selection = await read("eval/tiny-decision/v2/slayer/selection.json");
assert.ok(Date.parse(selection.selectedAt) <= Date.parse(freeze.lockedAt));
const inputs = await read("eval/tiny-decision/v2/data/holdout-inputs.json");
const labels = await read("eval/tiny-decision/v2/data/holdout-labels.json");
const v2 = await read(".tmp/v2-slayer-fresh.json");
const legacy = await read(".tmp/v2-slayer-legacy-fresh.json");
const ids = inputs.map((row) => row.id).sort();
assert.equal(ids.length, 18);
assert.equal(new Set(ids).size, 18);
assert.deepEqual(labels.map((row) => row.id).sort(), ids);
const conditions = [
  selection.selectedTemplates[0],
  "legacy-enriched",
  "korean-structure",
];
assert.deepEqual(
  [
    ...new Set([...v2.cases, ...legacy.cases].map((row) => row.template)),
  ].sort(),
  [...conditions].sort(),
);
for (const template of conditions) {
  const jobs = (template === "korean-structure" ? legacy : v2).cases.filter(
    (row) => row.template === template,
  );
  assert.deepEqual(
    jobs.map((row) => row.id).sort(),
    ids,
    `${template} must cover every fresh case once`,
  );
  for (const job of jobs) {
    const input = inputs.find((row) => row.id === job.id);
    const label = labels.find((row) => row.id === job.id);
    assert.equal(job.split, "holdout");
    assert.equal(job.field, input.field);
    assert.equal(job.expectedId, label.expectedId);
    assert.deepEqual(job.acceptedIds, label.acceptedIds || [label.expectedId]);
    assert.deepEqual(
      job.options,
      input.options.map((option) => ({ id: option.id, text: option.text })),
    );
    assert.equal(
      new Set(job.options.map((option) => option.id)).size,
      job.options.length,
    );
    for (const accepted of [job.expectedId, ...job.acceptedIds])
      assert.ok(job.options.some((option) => option.id === accepted));
    if (template === "korean-structure") {
      assert.equal(job.indexBase, 1);
      assert.equal(job.document, input.document);
      assert.equal(job.question, input.question);
      assert.equal(job.prompt, decisionPrompt(input, template));
      assert.equal(job.promptVariants, undefined);
    } else {
      assert.equal(job.indexBase, 0);
      assert.deepEqual(
        job.promptVariants.map((variant) => variant.textLimit),
        [96, 72, 48, 32],
      );
      for (const variant of job.promptVariants)
        assert.equal(
          variant.prompt,
          v2Prompt(input, template, {
            textLimit: variant.textLimit,
            indexBase: 0,
          }),
        );
    }
  }
}
const result = {
  checkedAt: new Date().toISOString(),
  globalFreezeAt: freeze.lockedAt,
  conditions,
  uniqueFreshCases: 18,
  totalJobs: 54,
  checks: [
    "Complete unique coverage in all three conditions",
    "Identical expected and accepted labels",
    "Original option identity/order and text",
    "Valid gold IDs",
    "Exact unchanged v1 prompt and 1-based numbering",
    "Exact frozen v2 prompts at all tiers and 0-based numbering",
  ],
  sources,
};
await writeFile(
  "eval/tiny-decision/v2/slayer/fresh-validation.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    checked: result.totalJobs,
    conditions,
    checks: result.checks.length,
  }),
);
