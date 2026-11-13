import test from "node:test";
import assert from "node:assert/strict";
import { preparePairs } from "./templates.mjs";
import { choose, selectConfiguration, scoreCases } from "./selection.mjs";
const input = { id: "fictional", split: "development", field: "title", pageEvidence: { url: "https://example.test/work/123?token=secret", documentTitle: "Cloud Garden", headings: [{ text: "Cloud Garden", hidden: false }] }, options: [{ id: "n1", evidence: { value: "Cloud Garden", nodes: [{ tag: "h1", attribute: "text", hidden: false, navigation: false, parents: [] }] } }, { id: "__none__" }] };
test("candidate model input excludes gold, provenance, opaque IDs and query values", () => {
  const jobs = preparePairs([input]);
  const changed = preparePairs([{ ...input, expectedId: "LABEL_SECRET", acceptedIds: ["LABEL_SECRET"], provenance: { work: "PROVENANCE_SECRET" } }]);
  assert.deepEqual(jobs, changed);
  for (const pair of jobs.pairs) {
    assert.equal(pair.variants.length, 3);
    assert.doesNotMatch(pair.premise + pair.query + pair.hypothesis, /LABEL_SECRET|PROVENANCE_SECRET|fictional|n1|token=secret/);
  }
});
test("pointwise selection is order invariant and ties/failures are never arbitrary candidates", () => {
  const scores = [{ candidateId: "a", score: 1 }, { candidateId: "b", score: 2 }];
  assert.deepEqual(choose(scores, 0), choose([...scores].reverse(), 0));
  assert.equal(choose(scores, 3).chosenId, "__none__");
  assert.equal(choose(scores.map(s => ({ ...s, score: 1 })), 0).chosenId, "__none__");
  assert.equal(choose([{ candidateId: "a", error: "budget" }], 0).valid, false);
  assert.equal(choose([], 0).chosenId, "__none__");
});
test("all planned candidate results are required and failures stay in denominator", () => {
  const jobs = preparePairs([input]);
  const labels = [{ id: input.id, split: "development", expectedId: "n1" }];
  const predictions = jobs.pairs.map(p => ({ id: p.id, error: "budget" }));
  assert.equal(scoreCases(jobs, labels, predictions, "en-role", 0)[0].correct, false);
  assert.throws(() => scoreCases(jobs, labels, predictions.slice(1), "en-role", 0), /planned pair/);
  assert.throws(() => selectConfiguration({ ...jobs, cases: jobs.cases.map(c => ({ ...c, split: "holdout" })) }, labels, predictions), /Development only/);
});
