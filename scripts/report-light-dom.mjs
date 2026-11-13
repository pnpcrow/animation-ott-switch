import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { preparePairs } from "../eval/light-dom/templates.mjs";
import { scoreCases } from "../eval/light-dom/selection.mjs";
import { predict } from "../eval/light-dom/structural.mjs";
import { summarizeCases, paired } from "../eval/light-dom/report.mjs";
import { chooseCompactHeuristic } from "../eval/tiny-decision/baseline.mjs";

const root = "eval/light-dom/";
export const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const same = (actual, expected, message) => { if (!isDeepStrictEqual(actual, expected)) throw new Error(message); };

// Check the exact preparation artifact, including timestamps, and regenerate its
// semantic payload independently from frozen observation-only inputs.
export function verifyJobsArchive(bytes, { report, inputs, template, inputsSha256, templateSha256 }) {
  if (hash(bytes) !== report.jobsSha256) throw new Error("Native jobs archive SHA mismatch");
  const jobs = JSON.parse(bytes), expected = preparePairs(inputs, [template]);
  for (const key of Object.keys(expected)) same(jobs[key], expected[key], "Prepared jobs differ: " + key);
  for (const record of [jobs, report]) {
    same(record.inputsSha256, inputsSha256, "Inference input SHA mismatch");
    same(record.templateSha256, templateSha256, "Inference template SHA mismatch");
  }
  same(report.maximumInputTokens ?? report.maxTokens, jobs.maxTokens, "Inference token budget mismatch");
  return jobs;
}

export function verifyModelIdentity(report, selection) {
  const browser = typeof report.model === "object";
  same(browser ? report.model.id : report.model, selection.model, "Model identity mismatch");
  same(browser ? report.model.revision : report.revision, selection.revision, "Model revision mismatch");
  same(report.modelSha256, selection.modelSha256, "Model weights SHA mismatch");
  if (browser) same(report.model.sha256, selection.modelSha256, "Browser model metadata SHA mismatch");
}

export function verifyModelFiles(fresh, development, exportManifest) {
  if (fresh.modelFiles || development.modelFiles) {
    if (!fresh.modelFiles || !development.modelFiles) throw new Error("One run is missing model/tokenizer file metadata");
    same(fresh.modelFiles, development.modelFiles, "Development/fresh model or tokenizer files differ");
    return { mode: "per-run-file-hashes", matchingDevelopment: true, files: fresh.modelFiles };
  }
  if (!exportManifest) throw new Error("Model/tokenizer provenance requires an export manifest");
  same(exportManifest.model, fresh.model, "Export manifest model mismatch");
  same(exportManifest.revision, fresh.revision, "Export manifest revision mismatch");
  same(exportManifest.export?.q8Sha256, fresh.modelSha256, "Exported weights SHA mismatch");
  if (!exportManifest.source?.files || !Object.keys(exportManifest.source.files).length) throw new Error("Export source file manifest is empty");
  return {
    mode: "export-manifest", sourceFiles: exportManifest.source.files,
    limitation: "The runner verifies source files against this export manifest on each run. Native development/fresh reports do not embed tokenizer file hashes, so this is not a direct comparison of per-run tokenizer metadata.",
  };
}

function attachLabels(inputs, labels, outputs) {
  const byLabel = new Map(labels.map(row => [row.id, row])), byOutput = new Map(outputs.map(row => [row.id, row]));
  if (new Set(inputs.map(row => row.id)).size !== inputs.length || byLabel.size !== labels.length || byOutput.size !== outputs.length || inputs.length !== labels.length || inputs.length !== outputs.length || inputs.some(row => !byLabel.has(row.id) || !byOutput.has(row.id))) throw new Error("Every unique input requires exactly one label and output, including failures");
  return inputs.map(input => {
    const output = byOutput.get(input.id), label = byLabel.get(input.id);
    const optionIds = input.options.map(option => option.id), acceptedIds = label.acceptedIds || [label.expectedId];
    if (new Set(optionIds).size !== optionIds.length || !optionIds.includes("__none__")) throw new Error("Unique observed options including none required");
    if (!Array.isArray(acceptedIds) || !acceptedIds.length || new Set(acceptedIds).size !== acceptedIds.length || !acceptedIds.includes(label.expectedId) || acceptedIds.some(id => !optionIds.includes(id))) throw new Error("Invalid scoring label or gold missing from pool");
    const valid = output.valid === true && !output.error && optionIds.includes(output.chosenId);
    return {
      ...output, id: input.id, field: input.field, split: input.split, optionIds,
      expectedId: label.expectedId, acceptedIds, valid,
      ...(!valid && !output.error ? { error: "Invalid or unobserved selection" } : {}),
      correct: valid && acceptedIds.includes(output.chosenId), trivialNoCandidate: optionIds.length === 1,
    };
  });
}

export function scoreLocalCases(inputs, labels, inference) {
  const outputs = inputs.map(input => {
    const started = performance.now();
    try {
      const result = inference(input);
      const output = typeof result === "string" ? { chosenId: result, valid: true } : result;
      return { ...output, id: input.id, elapsedMs: performance.now() - started };
    } catch (error) {
      return { id: input.id, valid: false, error: String(error), elapsedMs: performance.now() - started };
    }
  });
  return attachLabels(inputs, labels, outputs);
}

export function nativePredictions(report, jobs, name) {
  const byPair = new Map(jobs.pairs.map(pair => [pair.id, pair])), seen = new Set();
  const predictions = (report.predictions || []).map(result => {
    const pair = byPair.get(result.id);
    if (!pair || seen.has(result.id)) throw new Error("Unexpected or duplicate native prediction");
    seen.add(result.id);
    for (const key of ["caseId", "candidateId", "field", "template"]) same(result[key], pair[key], "Native prediction identity mismatch: " + key);
    if (!result.error && result.valid !== false) {
      if (!Number.isFinite(result.score)) return { ...result, valid: false, error: "Non-finite native score" };
      if (!Array.isArray(result.logits) || result.logits.length !== (name === "nli" ? 3 : 1) || result.logits.some(value => !Number.isFinite(value))) return { ...result, valid: false, error: "Invalid native logits" };
      const derived = name === "nli" ? result.logits[0] - result.logits[2] : result.logits[0];
      if (Math.abs(derived - result.score) > 1e-9) throw new Error("Native score differs from recorded logits");
      if (!jobs.textTiers.includes(result.textLimit) || !Number.isInteger(result.tokens) || result.tokens > jobs.maxTokens || result.tokens < 1) throw new Error("Native input exceeded the frozen text/token budget");
    }
    return result;
  });
  for (const pair of jobs.pairs) if (!seen.has(pair.id)) {
    if (!report.error) throw new Error("Missing native prediction without a recorded run failure");
    predictions.push({ id: pair.id, valid: false, error: report.error });
  }
  return predictions;
}

const plannedBatches = jobs => jobs.cases.filter(row => row.pairIds.length).map(row => ({ id: row.id + "::" + row.template, pairIds: row.pairIds }));
export function verifyBrowserJobs(bytes, report, jobs) {
  same(hash(bytes), report.jobsSha256, "Browser jobs archive SHA mismatch");
  const browserJobs = JSON.parse(bytes);
  same(browserJobs.nativeJobsSha256 || browserJobs.jobsSha256, report.sourceJobsSha256, "Browser jobs source SHA mismatch");
  same(browserJobs.model, report.model, "Browser job model metadata mismatch");
  same(browserJobs.batches.map(({ id, pairIds }) => ({ id, pairIds })), plannedBatches(jobs), "Browser tokenized jobs differ from native pair plan");
  same(browserJobs.batches.map(({ id, pairIds, repeats }) => ({ id, pairIds, repeats: repeats ?? 3 })), report.batchPlan, "Browser run differs from archived batch plan");
  for (const batch of browserJobs.batches) {
    if (!batch.inputs?.input_ids || !batch.inputs?.attention_mask) throw new Error("Browser tokenized inputs are missing");
    for (const input of Object.values(batch.inputs)) {
      if (!Array.isArray(input.dims) || input.dims.length !== 2 || !input.dims.every(Number.isInteger) || input.dims[0] !== batch.pairIds.length || input.dims[1] < 1 || input.dims[1] > jobs.maxTokens || input.data.length !== input.dims[0] * input.dims[1]) throw new Error("Browser input shape exceeds frozen pair/token budget");
    }
  }
  return browserJobs;
}

// Read actual browser tensors, never native reference scores. Failed batches retain
// every planned candidate; scoreCases also retains the automatic-none empty pool.
export function browserPredictions(report, jobs, name) {
  const planned = plannedBatches(jobs);
  same((report.batchPlan || []).map(({ id, pairIds }) => ({ id, pairIds })), planned, "Browser batch plan differs from observed native pairs");
  const byBatch = new Map((report.rows || []).map(row => [row.id, row]));
  if (byBatch.size !== (report.rows || []).length || [...byBatch.keys()].some(id => !planned.some(row => row.id === id))) throw new Error("Unexpected or duplicate browser output batch");
  const width = name === "nli" ? 3 : 1;
  return planned.flatMap(batch => {
    const row = byBatch.get(batch.id);
    if (!row && !report.error) throw new Error("Missing browser batch without a recorded run failure");
    if (row) same(row.pairIds, batch.pairIds, "Browser output pair order mismatch");
    let error = row?.error || (!row ? report.error : undefined);
    if (!error && (!isDeepStrictEqual(row.output?.dims, [batch.pairIds.length, width]) || row.output?.data?.length !== batch.pairIds.length * width)) error = "Browser output tensor shape mismatch";
    if (!error && Object.values(row.inputShapes || {}).some(shape => shape[0] !== batch.pairIds.length || shape[1] > jobs.maxTokens)) throw new Error("Browser input shape exceeds frozen pair/token budget");
    return batch.pairIds.map((id, index) => {
      const elapsedMs = Number.isFinite(row?.firstMs) ? row.firstMs / batch.pairIds.length : null;
      if (error) return { id, valid: false, error, elapsedMs };
      const logits = row.output.data.slice(index * width, (index + 1) * width);
      if (logits.some(value => !Number.isFinite(value))) return { id, valid: false, error: "Non-finite browser logits", elapsedMs };
      return { id, score: name === "nli" ? logits[0] - logits[2] : logits[0], valid: true, elapsedMs };
    });
  });
}

export function scoreStructuralBrowser(report, inputs, labels, { modelSha256, inputSha256, sourceHashes }) {
  same(report.modelSha256, modelSha256, "Browser structural model SHA mismatch");
  same(report.inputSha256, inputSha256, "Browser structural input SHA mismatch");
  same(report.sourceHashes, sourceHashes, "Browser structural served source SHA mismatch");
  return attachLabels(inputs, labels, report.rows.map(row => ({
    id: row.id, chosenId: row.chosenId, valid: row.valid, error: row.error,
    elapsedMs: row.warmMedianMs, firstMs: row.firstMs, warmP95Ms: row.warmP95Ms,
    reversedChosenId: row.reversedChosenId,
  })));
}

const readJson = async path => { const bytes = await readFile(path); return { bytes, data: JSON.parse(bytes) }; };
const requireFinished = (report, lockedAt) => {
  if (!report.finishedAt || !(Date.parse(report.finishedAt) >= Date.parse(lockedAt))) throw new Error("A completed post-freeze inference report is required");
};

export async function main() {
  const { data: freeze } = await readJson(root + "freeze.json");
  if (!freeze.lockedAt) throw new Error("Global freeze required");
  for (const [path, digest] of Object.entries(freeze.sources)) if (hash(await readFile(path)) !== digest) throw new Error("Frozen input/code changed: " + path);
  const selections = {};
  for (const [name, frozen] of Object.entries(freeze.selections)) {
    const { bytes, data } = await readJson(frozen.path);
    if (hash(bytes) !== frozen.sha256) throw new Error("Frozen selection changed");
    same(data.selected.template, frozen.template, "Frozen template differs from selection");
    same(data.selected.threshold, frozen.threshold, "Frozen threshold differs from selection");
    same(data.modelSha256, frozen.modelSha256, "Frozen model differs from selection");
    selections[name] = data;
  }
  const { data: inputs } = await readJson(root + "data/holdout-inputs.json"), { data: labels } = await readJson(root + "data/holdout-labels.json");
  const groups = {}, browserGroups = {}, sources = {}, jobsByName = {};
  for (const [name, path] of Object.entries({ nli: "nli/holdout.json", kure: "reports/kure-holdout.json", jina: "jina/holdout.json" })) {
    const { bytes, data: report } = await readJson(root + path), selection = selections[name];
    requireFinished(report, freeze.lockedAt); verifyModelIdentity(report, selection);
    const { bytes: devBytes, data: development } = await readJson(selection.source);
    if (hash(devBytes) !== selection.sourceSha256) throw new Error("Development source report changed");
    verifyModelIdentity(development, selection);
    const jobPath = root + "plans/" + name + "-holdout-jobs.json", jobBytes = await readFile(jobPath);
    const jobs = verifyJobsArchive(jobBytes, {
      report, inputs, template: selection.selected.template,
      inputsSha256: freeze.sources[root + "data/holdout-inputs.json"], templateSha256: freeze.sources[root + "templates.mjs"],
    });
    jobsByName[name] = jobs;
    const exportPath = name === "kure" ? root + "plans/kure-export-manifest.json" : null;
    const exported = exportPath ? await readJson(exportPath) : null;
    const fileAudit = verifyModelFiles(report, development, exported?.data);
    groups[name] = summarizeCases(scoreCases(jobs, labels, nativePredictions(report, jobs, name), selection.selected.template, selection.selected.threshold));
    sources[name] = {
      path: root + path, sha256: hash(bytes), model: report.model, revision: report.revision, modelSha256: report.modelSha256,
      jobs: { path: jobPath, sha256: hash(jobBytes), semanticallyMatchesPreparePairs: true }, fileAudit,
      ...(exported ? { exportManifest: { path: exportPath, sha256: hash(exported.bytes) } } : {}),
    };
  }
  const { data: model } = await readJson(root + "structural-model.json");
  for (const [name, inference] of Object.entries({ structural: input => predict(model, input), baseline: chooseCompactHeuristic, alwaysNone: () => "__none__" })) groups[name] = summarizeCases(scoreLocalCases(inputs, labels, inference));

  for (const [key, name, provider, path] of [
    ["nliWebgpu", "nli", "webgpu", "nli/browser-webgpu-holdout.json"],
    ["kureWebgpu", "kure", "webgpu", "reports/kure-browser-webgpu-holdout.json"],
    ["jinaWebgpu", "jina", "webgpu", "jina/browser-webgpu-holdout.json"],
    ["jinaWasm", "jina", "wasm", "jina/browser-wasm-holdout.json"],
  ]) {
    const { bytes, data: browser } = await readJson(root + path), selection = selections[name];
    requireFinished(browser, freeze.lockedAt); verifyModelIdentity(browser, selection);
    same(browser.requestedProvider, provider, "Browser provider mismatch");
    same(browser.sourceJobsSha256, sources[name].jobs.sha256, "Browser source jobs SHA mismatch");
    const jobPath = root + "plans/" + name + "-browser-jobs.json", jobBytes = await readFile(jobPath);
    verifyBrowserJobs(jobBytes, browser, jobsByName[name]);
    const rows = scoreCases(jobsByName[name], labels, browserPredictions(browser, jobsByName[name], name), selection.selected.template, selection.selected.threshold);
    browserGroups[key] = summarizeCases(rows);
    sources[key] = {
      path: root + path, sha256: hash(bytes), model: browser.model, modelSha256: browser.modelSha256,
      sourceJobsSha256: browser.sourceJobsSha256, jobs: { path: jobPath, sha256: hash(jobBytes), observedPairPlanMatches: true },
      provider, gpuObserved: browser.gpuObserved ?? false, implementationSha256: browser.implementationSha256,
    };
  }
  const structuralPath = root + "reports/structural-browser.json", { bytes: structuralBytes, data: structuralBrowser } = await readJson(structuralPath);
  requireFinished(structuralBrowser, freeze.lockedAt);
  const structuralSources = Object.fromEntries([root + "structural.mjs", "eval/tiny-decision/v2/features.mjs"].map(path => [path, freeze.sources[path]]));
  browserGroups.structuralJs = summarizeCases(scoreStructuralBrowser(structuralBrowser, inputs, labels, {
    modelSha256: freeze.sources[root + "structural-model.json"], inputSha256: freeze.sources[root + "data/holdout-inputs.json"], sourceHashes: structuralSources,
  }));
  sources.structuralJs = { path: structuralPath, sha256: hash(structuralBytes), modelSha256: structuralBrowser.modelSha256, inputSha256: structuralBrowser.inputSha256, sourceHashes: structuralBrowser.sourceHashes };
  const report = {
    schemaVersion: 2, finishedAt: new Date().toISOString(), globalFreezeAt: freeze.lockedAt, sources, groups, browserGroups,
    pairedToBaseline: Object.fromEntries(["nli", "kure", "jina", "structural"].map(name => [name, paired(groups.baseline, groups[name])])),
    browserPairedToBaseline: Object.fromEntries(Object.entries(browserGroups).map(([name, group]) => [name, paired(groups.baseline, group)])),
    timingScope: {
      nativeNeural: "Sum of allocated CPU inference batch time per field; excludes tokenization, loading, live DOM collection and network.",
      browserNeural: "Actual first forward plus output reduction per pretokenized field batch; excludes tensor preparation, tokenization, loading, live DOM collection and network. Some operators may run on CPU even when GPU submissions are observed. No warm-trial interpretation for one-pass holdout.",
      nodeStructural: "Observation featurePack, feature construction, vectorization, linear scoring and selection in Node; excludes live DOM collection and image/network access.",
      browserStructural: structuralBrowser.timingScope,
      comparisonLimit: "Browser structural elapsedMs is the per-field median of repeated full predictions, while browser neural elapsedMs is a first pass. These scopes are not identical end-to-end OTT navigation latency; firstMs is retained for structural rows.",
    },
  };
  await writeFile(root + "reports/comparison.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ groups: Object.fromEntries(Object.entries(groups).map(([name, r]) => [name, { all: r.all.correct, total: r.all.attempted, nontrivial: r.nontrivial.correct, nontrivialTotal: r.nontrivial.attempted }])), browserGroups: Object.fromEntries(Object.entries(browserGroups).map(([name, r]) => [name, { all: r.all.correct, total: r.all.attempted, nontrivial: r.nontrivial.correct, nontrivialTotal: r.nontrivial.attempted }])) }));
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
