import test from "node:test";
import assert from "node:assert/strict";
import { diagnosticSummary } from "./diagnostics.mjs";
test("always-absent proposals are not credited as positive-field improvement", () => {
  const rows = [
    {
      expectedId: "n1",
      valid: false,
      chosenId: null,
      suppressedId: "__none__",
    },
    {
      expectedId: "__none__",
      valid: false,
      chosenId: null,
      suppressedId: "__none__",
    },
  ];
  const d = diagnosticSummary(rows);
  assert.equal(d.positive.singleProposalCorrect, 0);
  assert.equal(d.none.singleProposalCorrect, 1);
  assert.equal(d.none.finalCorrect, 0);
});
test("alternative valid labels and errors remain correctly stratified", () => {
  const d = diagnosticSummary([
    {
      expectedId: "n1",
      acceptedIds: ["n1", "n2"],
      chosenId: "n2",
      valid: true,
      correct: true,
    },
    { expectedId: "n3", error: "budget", valid: false, correct: false },
  ]);
  assert.equal(d.positive.total, 2);
  assert.equal(d.positive.finalCorrect, 1);
  assert.equal(d.positive.singleProposalCorrect, 1);
});
