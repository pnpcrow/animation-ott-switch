import test from "node:test";
import assert from "node:assert/strict";
import { summarizeCases, paired } from "./report.mjs";
import { preparePairs } from "./templates.mjs";
import { scoreCases } from "./selection.mjs";
import {
  hash, verifyJobsArchive, verifyModelIdentity, verifyModelFiles, scoreLocalCases,
  nativePredictions, browserPredictions, verifyBrowserJobs, scoreStructuralBrowser,
} from "../../scripts/report-light-dom.mjs";

const inputs = [
  { id: "detail", field: "title", split: "holdout", options: [
    { id: "n1", evidence: { value: "Observed title", nodes: [{ tag: "h1", attribute: "textContent" }] } },
    { id: "n2", evidence: { value: "Navigation", nodes: [{ tag: "a", attribute: "textContent", navigation: true }] } },
    { id: "__none__" },
  ] },
  { id: "empty", field: "image", split: "holdout", options: [{ id: "__none__" }] },
];
const labels = [{ id: "detail", expectedId: "n1" }, { id: "empty", expectedId: "__none__" }];
const jobs = preparePairs(inputs, ["en-role"]);
const batch = { id: "detail::en-role", pairIds: jobs.cases[0].pairIds, repeats: 1 };
const browser = () => ({ batchPlan: [batch], rows: [{ ...batch, firstMs: 20, output: { dims: [2, 3], data: [4, 0, 1, 0, 1, 2] } }] });
test("empty candidate cases are reported but do not inflate nontrivial accuracy", () => {
  const report = summarizeCases([
    { id: "trivial", field: "image", expectedId: "__none__", chosenId: "__none__", valid: true, correct: true, trivialNoCandidate: true },
    { id: "positive", field: "title", expectedId: "n1", valid: false, correct: false, error: "failed", trivialNoCandidate: false },
  ]);
  assert.equal(report.all.accuracy, 0.5); assert.equal(report.nontrivial.accuracy, 0);
  assert.equal(report.nontrivial.positive.attempted, 1);
  assert.equal(report.all.errors, 1);
});
test("paired comparisons require matching unique IDs and count regressions", () => {
  const before = { rows: [{ id: "one", correct: true }, { id: "two", correct: false }] };
  const after = { rows: [{ id: "two", correct: true }, { id: "one", correct: false }] };
  assert.deepEqual(paired(before, after), { total: 2, bothCorrect: 0, improved: 1, regressed: 1, bothWrong: 0 });
  assert.throws(() => paired(before, { rows: [after.rows[0], after.rows[0]] }), /One-to-one/);
});

test("local exceptions and explicit invalid outputs remain failures even when the choice matches gold", () => {
  const rows = scoreLocalCases(inputs, labels, input => {
    if (input.id === "detail") throw new Error("inference failed");
    return { chosenId: "__none__", valid: false, error: "invalid weights" };
  });
  const result = summarizeCases(rows);
  assert.equal(result.all.attempted, 2); assert.equal(result.all.correct, 0);
  assert.equal(result.all.errors, 2); assert.equal(result.nontrivial.attempted, 1);
  assert.match(rows[0].error, /inference failed/); assert.equal(rows[1].valid, false);
});

test("valid choices with an error are never reclassified as successful outputs", () => {
  const rows = scoreLocalCases(inputs, labels, input => ({ chosenId: labels.find(label => label.id === input.id).expectedId, valid: true, error: "partial inference" }));
  assert.ok(rows.every(row => !row.correct && !row.valid));
  assert.throws(() => scoreLocalCases(inputs, [labels[0], labels[0]], () => "__none__"), /exactly one label/);
});

test("archive checks validate original bytes, regenerated evidence and token budget", () => {
  const archived = { ...jobs, inputsSha256: "input", templateSha256: "template", preparedAt: "time" };
  const bytes = Buffer.from(JSON.stringify(archived));
  const report = { jobsSha256: hash(bytes), inputsSha256: "input", templateSha256: "template", maxTokens: jobs.maxTokens };
  const options = { report, inputs, template: "en-role", inputsSha256: "input", templateSha256: "template" };
  assert.deepEqual(verifyJobsArchive(bytes, options), archived);
  assert.throws(() => verifyJobsArchive(Buffer.from(JSON.stringify({ ...archived, preparedAt: "other" })), options), /archive SHA/);
  const altered = structuredClone(archived); altered.pairs[0].passage = "annotation injected";
  const changed = Buffer.from(JSON.stringify(altered));
  assert.throws(() => verifyJobsArchive(changed, { ...options, report: { ...report, jobsSha256: hash(changed) } }), /Prepared jobs differ: pairs/);
  assert.throws(() => verifyJobsArchive(bytes, { ...options, report: { ...report, maxTokens: 512 } }), /token budget/);
});

test("model revision and tokenizer files must match the development selection", () => {
  const selection = { model: "model", revision: "rev", modelSha256: "sha" };
  assert.doesNotThrow(() => verifyModelIdentity(selection, selection));
  assert.throws(() => verifyModelIdentity({ ...selection, revision: "other" }, selection), /revision/);
  const modelFiles = { "tokenizer.json": { sha256: "tokenizer", bytes: 12 } };
  assert.equal(verifyModelFiles({ modelFiles }, { modelFiles }).matchingDevelopment, true);
  assert.throws(() => verifyModelFiles({ modelFiles }, { modelFiles: {} }), /tokenizer files differ/);
  const manifest = { ...selection, source: { files: modelFiles }, export: { q8Sha256: "sha" } };
  assert.match(verifyModelFiles(selection, selection, manifest).limitation, /not a direct comparison/);
  assert.throws(() => verifyModelFiles(selection, selection, { ...manifest, export: { q8Sha256: "other" } }), /weights SHA/);
});

test("native score identities and recorded logits are checked before labeling", () => {
  const predictions = jobs.pairs.map(pair => ({ ...pair, score: 2, logits: [3, 0, 1], tokens: 50, elapsedMs: 10 }));
  assert.equal(nativePredictions({ predictions }, jobs, "nli").length, 2);
  assert.throws(() => nativePredictions({ predictions: [{ ...predictions[0], candidateId: "n2" }, predictions[1]] }, jobs, "nli"), /identity mismatch/);
  assert.throws(() => nativePredictions({ predictions: [{ ...predictions[0], score: 99 }, predictions[1]] }, jobs, "nli"), /recorded logits/);
  const failed = nativePredictions({ predictions: [], error: "session load failed" }, jobs, "nli");
  const rows = scoreCases(jobs, labels, failed, "en-role", 1);
  assert.equal(rows.length, 2); assert.equal(rows[0].valid, false); assert.equal(rows[1].correct, true);
  assert.throws(() => nativePredictions({ predictions: [] }, jobs, "nli"), /Missing native prediction/);
});

test("actual browser logits determine decisions, allocated time and automatic-none cases", () => {
  const results = browserPredictions(browser(), jobs, "nli");
  assert.deepEqual(results.map(row => row.score), [3, -2]);
  const rows = scoreCases(jobs, labels, results, "en-role", 2);
  assert.equal(rows[0].chosenId, "n1"); assert.equal(rows[0].elapsedMs, 20);
  assert.equal(rows[1].chosenId, "__none__"); assert.equal(rows[1].trivialNoCandidate, true);
  const scalar = browser(); scalar.rows[0].output = { dims: [2, 1], data: [-3, 8] };
  assert.deepEqual(browserPredictions(scalar, jobs, "jina").map(row => row.score), [-3, 8]);
});

test("browser malformed tensors and run failures retain all planned decisions", () => {
  const malformed = browser(); malformed.rows[0].output.dims = [1, 6];
  const rows = scoreCases(jobs, labels, browserPredictions(malformed, jobs, "nli"), "en-role", 2);
  assert.equal(rows.length, 2); assert.equal(rows[0].valid, false); assert.equal(rows[1].correct, true);
  const crashed = { batchPlan: [batch], rows: [], error: "GPU unavailable" };
  assert.ok(browserPredictions(crashed, jobs, "nli").every(row => !row.valid && row.error === "GPU unavailable"));
  assert.throws(() => browserPredictions({ ...crashed, error: undefined }, jobs, "nli"), /Missing browser batch/);
  const duplicate = browser(); duplicate.rows.push(duplicate.rows[0]);
  assert.throws(() => browserPredictions(duplicate, jobs, "nli"), /duplicate browser/);
});

test("browser pair identities and ordering cannot silently acquire another candidate's score", () => {
  const altered = browser(); altered.rows[0].pairIds = [...batch.pairIds].reverse();
  assert.throws(() => browserPredictions(altered, jobs, "nli"), /pair order mismatch/);
  const report = browser(); report.rows[0].output.data[0] = NaN;
  assert.equal(browserPredictions(report, jobs, "nli")[0].valid, false);
});

test("browser tokenized archive hashes, source links, pair plans and shapes are checked", () => {
  const model = { id: "model", sha256: "sha" };
  const archived = { model, jobsSha256: "native", batches: [{ ...batch, inputs: {
    input_ids: { type: "int64", dims: [2, 2], data: [1, 2, 3, 4] },
    attention_mask: { type: "int64", dims: [2, 2], data: [1, 1, 1, 1] },
  } }] };
  const bytes = Buffer.from(JSON.stringify(archived));
  const report = { model, jobsSha256: hash(bytes), sourceJobsSha256: "native", batchPlan: [batch] };
  assert.doesNotThrow(() => verifyBrowserJobs(bytes, report, jobs));
  assert.throws(() => verifyBrowserJobs(bytes, { ...report, sourceJobsSha256: "other" }, jobs), /source SHA/);
  const altered = structuredClone(archived); altered.batches[0].inputs.input_ids.dims[1] = 400;
  const changed = Buffer.from(JSON.stringify(altered));
  assert.throws(() => verifyBrowserJobs(changed, { ...report, jobsSha256: hash(changed) }, jobs), /input shape/);
});

test("structural browser keeps explicit invalidity and requires frozen served source hashes", () => {
  const identity = { modelSha256: "model", inputSha256: "input", sourceHashes: { module: "source" } };
  const report = { ...identity, rows: [
    { id: "detail", chosenId: "n1", valid: false, error: "bad score", firstMs: 3, warmMedianMs: 1 },
    { id: "empty", chosenId: "__none__", valid: true, firstMs: 1, warmMedianMs: 0.5 },
  ] };
  const rows = scoreStructuralBrowser(report, inputs, labels, identity);
  assert.equal(rows[0].correct, false); assert.equal(rows[0].elapsedMs, 1); assert.equal(rows[0].firstMs, 3);
  assert.equal(rows[1].correct, true);
  assert.throws(() => scoreStructuralBrowser({ ...report, sourceHashes: { module: "changed" } }, inputs, labels, identity), /served source SHA/);
});
