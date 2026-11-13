import test from "node:test";
import assert from "node:assert/strict";
import { validatePlan, assembleCases } from "./contract.mjs";
const tensor = { type: "int64", dims: [1, 2], data: [1, 2] };
const batch = (id, candidate) => ({ id, caseId: "work", candidateIds: [candidate], pairIds: [`work::${candidate}`], inputs: { input_ids: tensor, attention_mask: tensor, token_type_ids: tensor } });
const plan = { schemaVersion: 2, cases: [{ id: "work", field: "title", candidateIds: ["a", "__none__"], batchIds: ["b1", "b2"] }], autoCases: [], batches: [batch("b1", "a"), batch("b2", "__none__")] };
test("microbatches cannot omit, reorder or duplicate candidates", () => {
  validatePlan(plan);
  const changed = structuredClone(plan); changed.batches[1].candidateIds = ["a"];
  assert.throws(() => validatePlan(changed), /identity/);
  const missing = structuredClone(plan); missing.cases[0].batchIds.pop(); missing.batches.pop();
  assert.throws(() => validatePlan(missing), /omitted/);
});
test("partial inference errors stay failed instead of making a confident choice", () => {
  const result = assembleCases(plan, [{ id: "b1", scores: [10], elapsedMs: 1 }, { id: "b2", error: "runtime" }]);
  assert.equal(result[0].valid, false);
  assert.equal(result[0].selected, undefined);
  assert.throws(() => assembleCases(plan, [{ id: "b1", scores: [10] }]), /Every planned/);
});
test("chunk assembly uses original identities and sums inference cost", () => {
  const result = assembleCases(plan, [{ id: "b2", scores: [0], elapsedMs: 2 }, { id: "b1", scores: [1], elapsedMs: 3 }])[0];
  assert.equal(result.selected, "a"); assert.equal(result.inferenceMs, 5);
  assert.deepEqual(result.scores, [1, 0]);
});
test("only an empty concrete pool can skip the model", () => {
  const changed = structuredClone(plan); changed.batches = []; changed.cases[0].batchIds = []; changed.autoCases = [{ id: "work", selected: "__none__" }];
  assert.throws(() => validatePlan(changed), /empty concrete pool/);
  changed.cases[0].candidateIds = ["__none__"];
  assert.equal(assembleCases(changed, [])[0].automaticNone, true);
});
test("near ties preserve the native exact-tie decision contract", () => {
  const result = assembleCases(plan, [{ id: "b1", scores: [0.0001000005], elapsedMs: 1 }, { id: "b2", scores: [0.0001], elapsedMs: 1 }])[0];
  assert.equal(result.selected, "a");
  const tied = assembleCases(plan, [{ id: "b1", scores: [0.0001], elapsedMs: 1 }, { id: "b2", scores: [0.0001], elapsedMs: 1 }])[0];
  assert.equal(tied.selected, "__none__");
});
