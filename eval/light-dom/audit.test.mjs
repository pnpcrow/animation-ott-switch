import test from "node:test";
import assert from "node:assert/strict";
import { preparePairs } from "./templates.mjs";
import { choose, scoreCases, selectConfiguration } from "./selection.mjs";
import { encodeDataset, featureNames, fit, predict, predictEncoded } from "./structural.mjs";
const input = {
  id: "fixture", field: "title", split: "development",
  pageEvidence: { url: "https://example.test/title/7", documentTitle: "Cloud Garden", headings: [{ text: "Cloud Garden", hidden: false }] },
  options: [
    { id: "a", evidence: { value: "Cloud Garden", nodes: [{ tag: "h1", attribute: "text", hidden: false, navigation: false, parents: [] }] } },
    { id: "b", evidence: { value: "Episode 4", nodes: [{ tag: "h2", attribute: "text", hidden: false, navigation: false, parents: [] }] } },
    { id: "__none__" },
  ],
};
const label = { id: input.id, split: "development", expectedId: "a", acceptedIds: ["a"], provenance: { work: "fictional" } };
const jobs = preparePairs([input]);
const predictions = jobs.pairs.map(pair => ({ id: pair.id, score: pair.candidateId === "a" ? 2 : 1, elapsedMs: 3 }));

test("malformed accepted labels cannot create a zero-denominator training objective", () => {
  const names = featureNames(input);
  assert.throws(() => encodeDataset([input], [{ ...label, acceptedIds: [] }], names), /nonempty/);
  assert.throws(() => encodeDataset([input], [{ ...label, acceptedIds: ["b"] }], names), /consistent/);
  const encoded = encodeDataset([input], [label], names);
  assert.throws(() => fit(encoded.map(row => ({ ...row, candidates: row.candidates.map(c => ({ ...c, accepted: false })) })), names), /accepted observed/);
});

test("structural inference rejects corrupt scores and propagates an explicit failure", () => {
  const names = featureNames(input), rows = encodeDataset([input], [label], names);
  const good = fit(rows, names, { epochs: 10 });
  for (const bad of [NaN, Infinity]) {
    const model = { ...good, weights: good.weights.map((w, i) => i === 0 ? bad : w) };
    assert.equal(predictEncoded(model, rows[0]).valid, false);
    const observed = predict(model, input);
    assert.equal(observed.valid, false); assert.match(observed.error, /Non-finite/);
  }
  assert.equal(predictEncoded({ ...good, weights: good.weights.slice(1) }, rows[0]).valid, false);
});

test("failed finite candidate results invalidate the whole planned case without becoming none", () => {
  assert.equal(choose([{ candidateId: "a", score: 2, valid: false }], 0).valid, false);
  const rows = scoreCases(jobs, [label], predictions.map((p, i) => i === 0 ? { ...p, valid: false } : p), "en-role", 0);
  assert.equal(rows.length, 1); assert.equal(rows[0].valid, false); assert.equal(rows[0].correct, false);
  assert.equal(rows[0].elapsedMs, 6);
});

test("duplicate, orphan and silently omitted planned candidates are rejected", () => {
  assert.throws(() => scoreCases({ ...jobs, pairs: [...jobs.pairs, jobs.pairs[0]] }, [label], predictions, "en-role", 0), /Duplicate planned pair/);
  assert.throws(() => scoreCases({ ...jobs, cases: [...jobs.cases, jobs.cases[0]] }, [label], predictions, "en-role", 0), /Duplicate planned case/);
  const omitted = structuredClone(jobs); omitted.cases[0].pairIds.pop();
  assert.throws(() => scoreCases(omitted, [label], predictions, "en-role", 0), /Every concrete candidate/);
  const orphan = structuredClone(jobs); orphan.pairs.push({ ...jobs.pairs[0], id: "orphan" });
  assert.throws(() => scoreCases(orphan, [label], predictions, "en-role", 0), /Unreferenced pair/);
});

test("templates cannot be ranked against differently sized case cohorts", () => {
  const two = preparePairs([input, { ...input, id: "fixture2" }]);
  const changed = structuredClone(two);
  const removed = changed.cases.find(row => row.id === "fixture2" && row.template === "ko-role");
  changed.cases = changed.cases.filter(row => row !== removed);
  changed.pairs = changed.pairs.filter(pair => !removed.pairIds.includes(pair.id));
  const output = changed.pairs.map(pair => ({ id: pair.id, score: 1 }));
  assert.throws(() => scoreCases(changed, [label, { ...label, id: "fixture2" }], output, "en-role", 0), /same planned cases/);
});

test("a true empty concrete pool stays explicit and separate from failed inference", () => {
  const empty = { ...input, id: "empty", options: [{ id: "__none__" }] };
  const emptyJobs = preparePairs([empty]);
  const emptyLabel = { ...label, id: "empty", expectedId: "__none__", acceptedIds: ["__none__"] };
  const [result] = scoreCases(emptyJobs, [emptyLabel], [], "en-role", 0);
  assert.equal(result.correct, true); assert.equal(result.trivialNoCandidate, true);
  assert.equal(result.elapsedMs, 0); assert.equal(result.chosenId, "__none__");
});

test("changing scoring gold cannot alter the observed structural feature vectors", () => {
  const names = featureNames(input);
  const a = encodeDataset([input], [label], names);
  const b = encodeDataset([input], [{ ...label, expectedId: "b", acceptedIds: ["b"] }], names);
  assert.deepEqual(a[0].candidates.map(c => [...c.x]), b[0].candidates.map(c => [...c.x]));
  assert.notDeepEqual(a[0].candidates.map(c => c.accepted), b[0].candidates.map(c => c.accepted));
});

test("garbage numeric scores attached to failed inferences cannot steer the selected cutoff", () => {
  const both = preparePairs([input, { ...input, id: "absent" }]);
  const labels = [label, { ...label, id: "absent", expectedId: "__none__", acceptedIds: ["__none__"] }];
  const run = garbage => both.pairs.map(pair => ({ id: pair.id, score: pair.candidateId === "a" ? 2 : 1, ...(pair.caseId === input.id && pair.candidateId === "a" ? { score: garbage, valid: false } : {}) }));
  const high = selectConfiguration(both, labels, run(1e9)).selected;
  const low = selectConfiguration(both, labels, run(-1e9)).selected;
  assert.equal(high.template, low.template); assert.equal(high.threshold, low.threshold);
  assert.equal(high.summary.correct, 1); assert.equal(high.summary.attempted, 2);
});
