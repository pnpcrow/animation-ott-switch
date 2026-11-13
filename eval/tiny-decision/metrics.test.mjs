import test from "node:test";
import assert from "node:assert/strict";
import {
  decisionPrompt,
  templates,
  authorDecisionPrompt,
} from "./templates.mjs";
import { score, summarize, selectTemplate } from "./metrics.mjs";
const row = {
  id: "private-case",
  split: "holdout",
  provenance: "hidden provenance",
  expectedId: "n2",
  document: "<main><h1>Heading</h1></main>",
  question: "Which title?",
  options: [
    { id: "n2", text: "heading node" },
    { id: "__none__", text: "none" },
  ],
};
test("templates never leak expected IDs, split, case labels or provenance", () => {
  for (const t of templates) {
    const p = decisionPrompt(row, t.id);
    assert.ok(p.endsWith("Best answer: ["));
    for (const secret of [row.id, row.split, row.provenance, row.expectedId])
      assert.ok(!p.includes(secret));
  }
});
test("author-format control uses only observed state, question and numbered options", () => {
  const prompt = authorDecisionPrompt(row);
  assert.ok(prompt.startsWith("State: \n"));
  assert.ok(prompt.endsWith("Best answer: ["));
  for (const secret of [row.id, row.split, row.provenance, row.expectedId])
    assert.ok(!prompt.includes(secret));
});
test("abstention, invalid IDs and runtime errors remain in accuracy denominator", () => {
  const stats = summarize([
    score(row, { chosenId: "n2", elapsedMs: 1 }),
    score(row, { chosenId: "made-up", elapsedMs: 2 }),
    score(row, { chosenId: "__none__", elapsedMs: 3 }),
    score(row, { error: "timeout", elapsedMs: 4 }),
  ]);
  assert.equal(stats.accuracy, 0.25);
  assert.equal(stats.valid, 2);
  assert.equal(stats.errors, 1);
});
test("template selection cannot use a perfect held-out result", () => {
  const selection = selectTemplate([
    {
      template: "a",
      split: "calibration",
      summary: { accuracy: 0.5, falseSelections: 1, valid: 4, p50Ms: 5 },
    },
    {
      template: "b",
      split: "holdout",
      summary: { accuracy: 1, falseSelections: 0, valid: 4, p50Ms: 1 },
    },
  ]);
  assert.equal(selection.template, "a");
  assert.equal(selection.automaticNavigation, false);
});
test("equivalent annotations are accepted without exposing labels to prompts", () => {
  const equivalent = {
    ...row,
    acceptedIds: ["n2", "n3"],
    options: [...row.options, { id: "n3", text: "responsive artwork" }],
  };
  assert.equal(score(equivalent, { chosenId: "n3" }).correct, true);
  assert.ok(
    !decisionPrompt(equivalent, "native-minimal").includes("acceptedIds"),
  );
});
