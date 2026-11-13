import test from "node:test";
import assert from "node:assert/strict";
import { scorePinned, pairedOutcomes } from "./analysis.mjs";
const corpus = [
  { id: "positive", field: "title", expectedId: "n1", options: [{ id: "n1" }, { id: "n2" }, { id: "__none__" }] },
  { id: "absent", field: "image", expectedId: "__none__", options: [{ id: "n1" }, { id: "__none__" }] },
];
test("complete joined denominators distinguish errors, abstention and positive selection", () => {
  const result = scorePinned(corpus, [{ id: "positive", valid: false, error: "budget" }, { id: "absent", valid: true, chosenId: "__none__" }]);
  assert.equal(result.summary.attempted, 2); assert.equal(result.summary.correct, 1);
  assert.equal(result.target.positive.correct, 0); assert.equal(result.target.none.correct, 1);
  assert.equal(result.summary.errors, 1);
  assert.throws(() => scorePinned(corpus, []), /coverage/);
  assert.throws(() => scorePinned(corpus, [{ id: "positive" }, { id: "positive" }]), /Duplicate/);
});
test("frozen labels override neither fabricated scores nor unobserved nodes", () => {
  assert.throws(() => scorePinned(corpus, [{ id: "positive", chosenId: "fabricated", valid: true, correct: true }, { id: "absent" }]), /score disagrees/);
  const result = scorePinned(corpus, [{ id: "positive", chosenId: "fabricated", valid: true }, { id: "absent", chosenId: "__none__", valid: false }]);
  assert.equal(result.summary.correct, 0);
});
test("paired diagnostics compare semantic IDs and expose regressions", () => {
  const before = scorePinned(corpus, [{ id: "positive", chosenId: "n1", valid: true }, { id: "absent", chosenId: "n1", valid: true }]);
  const after = scorePinned(corpus, [{ id: "absent", chosenId: "__none__", valid: true }, { id: "positive", chosenId: "n2", valid: true }]);
  assert.equal(pairedOutcomes(before, after).regressed, 1);
  assert.equal(pairedOutcomes(before, after).improved, 1);
  assert.equal(pairedOutcomes(before, after).sameChoice, 0);
});
