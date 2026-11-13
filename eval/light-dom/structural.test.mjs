import test from "node:test";
import assert from "node:assert/strict";
import { candidateFacts, featureNames, encodeDataset, fit, predict } from "./structural.mjs";
const input = { id: "sample", split: "development", field: "title", pageEvidence: { url: "https://fictional.test/title/123", documentTitle: "Cloud Garden", headings: [{ text: "Cloud Garden", hidden: false }] }, options: [
  { id: "n1", evidence: { value: "Cloud Garden", nodes: [{ tag: "h1", attribute: "text", hidden: false, navigation: false, parents: [] }] } },
  { id: "n2", evidence: { value: "Episode 2", nodes: [{ tag: "h2", attribute: "text", hidden: false, navigation: false, parents: [] }] } },
  { id: "__none__" },
] };
test("structural features cannot be steered by annotations, site names or option position", () => {
  const original = candidateFacts(input, input.options[0]);
  const changed = { ...input, expectedId: "n2", provenance: { work: "gold" }, pageEvidence: { ...input.pageEvidence, url: "https://different.test/title/456" }, options: [...input.options].reverse() };
  assert.deepEqual(candidateFacts(changed, input.options[0]), original);
  assert.ok(Object.values(original).every(v => Number.isFinite(v) && v >= 0 && v <= 1));
});
test("learned model consumes observations only and keeps permutation invariance", () => {
  const names = featureNames(input);
  const rows = encodeDataset([input], [{ id: input.id, expectedId: "n1", provenance: { work: "group" } }], names);
  const model = fit(rows, names, { epochs: 100 });
  assert.equal(predict(model, input).chosenId, "n1");
  assert.equal(predict(model, { ...input, options: [...input.options].reverse(), expectedId: "n2" }).chosenId, "n1");
  assert.throws(() => fit(rows.map(r => ({ ...r, split: "holdout" })), names), /development only/);
});
test("unobserved dimensions remain missing and duplicate gold/data cannot train", () => {
  const facts = candidateFacts(input, input.options[0]);
  assert.equal(facts.dimensionsObserved, 0); assert.equal(facts.tinyImage, 0);
  assert.throws(() => encodeDataset([input, input], [{ id: input.id, expectedId: "n1" }]), /Duplicate/);
  assert.throws(() => encodeDataset([input], [{ id: input.id, expectedId: "unseen" }]), /Unobserved gold/);
});
