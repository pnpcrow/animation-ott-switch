import test from "node:test";
import assert from "node:assert/strict";
import { rank, rescore } from "./audit-results.mjs";

test("readout refuses duplicate or invalid scores and never resolves a tie by position", () => {
  assert.throws(() => rank(["a", "a"], [1, 2]), /Duplicate/);
  assert.throws(() => rank(["a"], [NaN]), /Invalid/);
  assert.equal(rank(["a", "b"], [1, 1]), "__none__");
  assert.equal(rank(["a", "b"], [1, 2], { threshold: 3 }), "__none__");
  assert.equal(rank(["b", "a"], [2, 1]), "b");
});
test("audit rejects missing and out-of-pool outputs instead of shrinking denominator", () => {
  const inputs = [{ id: "page", options: [{ id: "a" }, { id: "__none__" }] }];
  const labels = [{ id: "page", expectedId: "a" }];
  assert.throws(() => rescore([], labels, inputs), /Missing predictions/);
  assert.throws(() => rescore([{ id: "page", selected: "invented" }], labels, inputs), /unobserved/);
  const summary = rescore([{ id: "page", selected: "__none__" }], labels, inputs);
  assert.equal(summary.total, 1);
  assert.equal(summary.correct, 0);
  assert.equal(summary.abstentions, 1);
});
test("audit rejects duplicated or inconsistent gold even when counts match", () => {
  const inputs = ["first", "second"].map(id => ({ id, options: [{ id: "a" }, { id: "__none__" }] }));
  const rows = inputs.map(x => ({ id: x.id, selected: "a" }));
  const labels = inputs.map(x => ({ id: x.id, expectedId: "a" }));
  assert.throws(() => rescore(rows, [labels[0], labels[0]], inputs), /Duplicate labels/);
  assert.throws(() => rescore(rows, [{ ...labels[0], acceptedIds: [] }, labels[1]], inputs), /Invalid accepted/);
  assert.throws(() => rescore(rows, [{ ...labels[0], acceptedIds: ["a", "unknown"] }, labels[1]], inputs), /Gold outside/);
});
