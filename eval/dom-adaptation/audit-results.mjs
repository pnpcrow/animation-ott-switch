// Independent readout: do not import training loss, selection or scoring helpers.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export function rank(ids, scores, { threshold = -Infinity, tieTolerance = 0 } = {}) {
  assert.equal(ids.length, scores.length);
  assert.equal(new Set(ids).size, ids.length, "Duplicate candidates");
  assert.ok(scores.every(Number.isFinite), "Invalid scores");
  if (!ids.length) return "__none__";
  const order = ids.map((id, i) => ({ id, score: scores[i] })).sort((a, b) => b.score - a.score);
  if (order[0].score < threshold || (order[1] && (order[0].score === order[1].score || Math.abs(order[0].score - order[1].score) < tieTolerance))) return "__none__";
  return order[0].id;
}

export function rescore(rows, labels, inputs) {
  assert.equal(rows.length, labels.length, "Missing predictions");
  assert.equal(new Set(rows.map(x => x.id)).size, rows.length, "Duplicate predictions");
  const byId = new Map(rows.map(row => [row.id, row]));
  const observed = new Map(inputs.map(row => [row.id, row]));
  assert.equal(new Set(labels.map(x => x.id)).size, labels.length, "Duplicate labels");
  assert.equal(observed.size, inputs.length, "Duplicate inputs");
  assert.equal(observed.size, labels.length);
  assert.deepEqual([...byId.keys()].sort(), labels.map(x => x.id).sort(), "Prediction coverage mismatch");
  assert.deepEqual([...observed.keys()].sort(), labels.map(x => x.id).sort(), "Input coverage mismatch");
  const result = { total: labels.length, correct: 0, positiveCorrect: 0, noneCorrect: 0, falseSelections: 0, abstentions: 0, nontrivialTotal: 0, nontrivialCorrect: 0 };
  for (const label of labels) {
    const row = byId.get(label.id), input = observed.get(label.id);
    assert.ok(row && input, `Missing case ${label.id}`);
    assert.ok(input.options.some(x => x.id === row.selected), "Selected unobserved candidate");
    const accepted = label.acceptedIds ?? [label.expectedId];
    assert.ok(accepted.length && accepted.includes(label.expectedId), "Invalid accepted targets");
    assert.equal(new Set(accepted).size, accepted.length, "Duplicate accepted targets");
    assert.ok(accepted.every(id => input.options.some(x => x.id === id)), "Gold outside observed pool");
    const ok = accepted.includes(row.selected), negative = accepted.includes("__none__");
    result.correct += Number(ok);
    result.positiveCorrect += Number(ok && !negative);
    result.noneCorrect += Number(ok && negative);
    result.falseSelections += Number(!ok && row.selected !== "__none__");
    result.abstentions += Number(row.selected === "__none__");
    if (input.options.some(x => x.id !== "__none__")) { result.nontrivialTotal++; result.nontrivialCorrect += Number(ok); }
  }
  return result;
}

async function main() {
  const root = new URL("../../", import.meta.url), hashes = {};
  const verifyHash = async (path, expected) => {
    let normalized = path.replaceAll("\\", "/");
    // Python __file__ was absolute on the original Windows host. Map only
    // recorded evaluation-source paths back into this checkout for portable audits.
    if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith("/")) {
      const marker = normalized.indexOf("/eval/dom-adaptation/");
      assert.ok(marker >= 0, "Unrecognized absolute source path");
      normalized = normalized.slice(marker + 1);
    }
    assert.ok(!normalized.split("/").includes(".."), "Source path escapes checkout");
    const bytes = await readFile(new URL(normalized, root));
    const actual = createHash("sha256").update(bytes).digest("hex");
    assert.equal(actual, expected, `Changed source/input: ${path}`);
    hashes[normalized] = actual;
  };
  const read = async path => {
    const bytes = await readFile(new URL(path, root));
    hashes[path] = createHash("sha256").update(bytes).digest("hex");
    return JSON.parse(bytes);
  };
  const optional = async path => { try { return await read(path); } catch (error) { if (error.code === "ENOENT") return null; throw error; } };
  const datasets = {};
  for (const split of ["development", "holdout"]) datasets[split] = {
    inputs: await read(`eval/light-dom/data/${split}-inputs.json`),
    labels: await read(`eval/light-dom/data/${split}-labels.json`),
  };
  const groups = [], browserMeasurements = [];
  const comparison = await read("eval/dom-adaptation/templates/comparison.json");
  const selection = await read("eval/dom-adaptation/templates/selection.json");
  for (const [path, expected] of Object.entries(selection.sourceHashes)) await verifyHash(path, expected);
  for (const part of ["development", "retrospective"]) {
    const raw = await read(`eval/dom-adaptation/templates/${part}.json`);
    const planPath = `eval/dom-adaptation/templates/plans/${part}-jobs.json`;
    const plan = await read(planPath);
    assert.equal(raw.jobsSha256, hashes[planPath]);
    const plannedPairs = new Map(plan.pairs.map(x => [x.id, x]));
    assert.equal(plannedPairs.size, plan.pairs.length);
    assert.deepEqual(raw.predictions.map(x => x.id).sort(), [...plannedPairs.keys()].sort());
    assert.equal(new Set(comparison[part].map(x => x.template)).size, comparison[part].length, "Duplicate template groups");
    assert.deepEqual(comparison[part].map(x => x.template).sort(), [...plan.templates].sort());
    assert.deepEqual(selection.perTemplate.map(x => x.template).sort(), [...plan.templates].sort());
    const byCase = new Map();
    assert.equal(new Set(raw.predictions.map(x => x.id)).size, raw.predictions.length);
    for (const prediction of raw.predictions) {
      assert.ok(!prediction.error && prediction.logits.length === 3);
      const pair = plannedPairs.get(prediction.id);
      for (const key of ["caseId", "candidateId", "template", "field"]) assert.equal(prediction[key], pair[key]);
      const derived = prediction.logits[0] - prediction.logits[2];
      assert.ok(Math.abs(derived - prediction.score) < 1e-12, "NLI score disagrees with logits");
      const key = `${prediction.caseId}\0${prediction.template}`;
      if (!byCase.has(key)) byCase.set(key, []);
      byCase.get(key).push({ id: prediction.candidateId, score: derived, predictionId: prediction.id });
    }
    const data = datasets[part === "development" ? "development" : "holdout"];
    const accountedFor = new Set();
    for (const template of comparison[part]) {
      const locked = selection.perTemplate.find(x => x.template === template.template);
      assert.equal(locked.threshold, template.threshold);
      assert.deepEqual(template.decisions.map(x => x.id).sort(), data.inputs.map(x => x.id).sort());
      const rows = data.inputs.map(input => {
        const scores = byCase.get(`${input.id}\0${template.template}`) || [];
        assert.deepEqual(scores.map(x => x.id).sort(), input.options.filter(x => x.id !== "__none__").map(x => x.id).sort(), "Missing candidate inference");
        for (const row of scores) { assert.ok(!accountedFor.has(row.predictionId)); accountedFor.add(row.predictionId); }
        const selected = rank(scores.map(x => x.id), scores.map(x => x.score), { threshold: template.threshold, tieTolerance: 1e-9 });
        assert.equal(selected, template.decisions.find(x => x.id === input.id)?.chosenId, "NLI decision mismatch");
        return { id: input.id, selected };
      });
      const summary = rescore(rows, data.labels, data.inputs);
      assert.equal(summary.correct, template.summary.correct);
      assert.equal(summary.total, template.summary.attempted);
      assert.equal(summary.total, template.summary.valid);
      assert.equal(template.summary.errors, 0);
      assert.equal(summary.falseSelections, template.summary.falseSelections);
      assert.equal(summary.positiveCorrect, template.positiveCorrect);
      assert.equal(summary.noneCorrect, template.negativeCorrect);
      assert.equal(data.labels.filter(x => x.expectedId !== "__none__").length, template.positiveTotal);
      assert.equal(data.labels.filter(x => x.expectedId === "__none__").length, template.negativeTotal);
      assert.equal(summary.nontrivialCorrect, template.nontrivial.correct);
      assert.equal(summary.nontrivialTotal, template.nontrivial.attempted);
      groups.push({ name: `nli/${part}/${template.template}`, ...summary });
    }
    assert.equal(accountedFor.size, raw.predictions.length, "Unplanned predictions");
  }
  const trained = await read("eval/dom-adaptation/finetune/report.json");
  for (const [path, expected] of Object.entries(trained.sourceSha256)) await verifyHash(path, expected);
  for (const [path, expected] of Object.entries(trained.dataSha256)) {
    const normalized = path.replaceAll("\\", "/");
    const archived = normalized.replace(".tmp/dom-adaptation/finetune/", "eval/dom-adaptation/finetune/plans/");
    await verifyHash(archived, expected);
  }
  const auditNeural = (name, rows, declared, data) => {
    for (const row of rows) {
      const ids = data.inputs.find(x => x.id === row.id)?.options.map(x => x.id);
      assert.deepEqual([...row.candidateIds].sort(), ids?.sort(), "Candidate pool changed");
      assert.equal(rank(row.candidateIds, row.scores), row.selected, "Neural decision mismatch");
    }
    const summary = rescore(rows, data.labels, data.inputs);
    for (const [key, value] of Object.entries(declared)) assert.equal(summary[key], value, `Summary mismatch: ${key}`);
    groups.push({ name, ...summary });
  };
  for (const recipe of ["frozenEncoder", "fullEncoder"]) {
    auditNeural(`koelectra/${recipe}/training`, trained[recipe].trainingPredictions, trained[recipe].trainingScore, datasets.development);
    auditNeural(`koelectra/${recipe}/retrospective`, trained[recipe].retrospectivePredictions, trained[recipe].retrospectiveScore, datasets.holdout);
  }
  const providerFold = await optional("eval/dom-adaptation/finetune/provider-fold.json");
  if (providerFold) {
    await verifyHash("eval/dom-adaptation/finetune/provider-fold.py", providerFold.sourceSha256);
    await verifyHash("eval/dom-adaptation/finetune/train.py", providerFold.sharedTrainSourceSha256);
    await verifyHash("eval/dom-adaptation/finetune/design.json", providerFold.recipeSourceSha256);
    for (const [path, expected] of Object.entries(providerFold.inputsSha256)) {
      await verifyHash(path.replaceAll("\\", "/").replace(".tmp/dom-adaptation/finetune/", "eval/dom-adaptation/finetune/plans/"), expected);
    }
    const audit = await read("eval/dom-adaptation/corpus-audit.json");
    assert.equal(providerFold.auditSha256, hashes["eval/dom-adaptation/corpus-audit.json"]);
    const declaredFold = audit.folds.find(row => row.provider === providerFold.fold.provider);
    assert.deepEqual(providerFold.fold, declaredFold);
    const all = { inputs: [...datasets.development.inputs, ...datasets.holdout.inputs], labels: [...datasets.development.labels, ...datasets.holdout.labels] };
    for (const recipe of ["frozenEncoder", "fullEncoder"]) for (const part of ["training", "test"]) {
      const ids = new Set(part === "training" ? declaredFold.trainIds : declaredFold.testIds);
      const data = { inputs: all.inputs.filter(x => ids.has(x.id)), labels: all.labels.filter(x => ids.has(x.id)) };
      auditNeural(`koelectra/provider-${declaredFold.provider}/${recipe}/${part}`, providerFold[recipe][`${part}Predictions`], providerFold[recipe][`${part}Score`], data);
    }
  }
  const exported = await read("eval/dom-adaptation/finetune/export-report.json");
  await verifyHash("eval/dom-adaptation/finetune/export.py", exported.sourceSha256);
  auditNeural("koelectra/q8/retrospective", exported.rows, exported.retrospectiveScore, datasets.holdout);
  for (const provider of ["wasm", "webgpu"]) {
    const browser = await optional(`eval/dom-adaptation/finetune/browser-${provider}.json`);
    if (!browser) continue;
    assert.ok(!browser.error && browser.finishedAt, "Incomplete browser run");
    assert.equal(browser.modelSha256, exported.q8.sha256);
    const browserPlanPath = "eval/dom-adaptation/finetune/plans/browser-jobs.json";
    const browserPlan = await read(browserPlanPath);
    assert.equal(browser.jobsSha256, hashes[browserPlanPath]);
    assert.equal(browserPlan.model.sha256, exported.q8.sha256);
    assert.deepEqual(browser.rows.map(x => x.id).sort(), browserPlan.batches.map(x => x.id).sort());
    for (const [path, expected] of Object.entries(browser.implementationSha256)) await verifyHash(path, expected);
    const rows = browser.rows.map(row => {
      assert.ok(!row.error && row.output);
      const planned = browserPlan.batches.find(x => x.id === row.id);
      assert.deepEqual(row.pairIds, planned.pairIds);
      const candidateIds = exported.rows.find(x => x.id === row.id)?.candidateIds;
      assert.deepEqual(row.pairIds, candidateIds.map(id => `${row.id}::${id}`));
      assert.deepEqual(row.output.dims, [candidateIds.length]);
      return { id: row.id, candidateIds, scores: row.output.data, selected: rank(candidateIds, row.output.data) };
    });
    auditNeural(`koelectra/browser-${provider}/retrospective`, rows, {}, datasets.holdout);
    const nontrivialIds = new Set(datasets.holdout.inputs.filter(x => x.options.some(option => option.id !== "__none__")).map(x => x.id));
    const times = browser.rows.filter(x => nontrivialIds.has(x.id)).map(x => x.firstMs).sort((a, b) => a - b);
    assert.ok(times.length === 17 && times.every(Number.isFinite));
    const memory = browser.processMemory.filter(x => Number.isFinite(x.workingSetBytes));
    browserMeasurements.push({
      provider, measuredNontrivialFields: times.length, firstP50Ms: times[Math.floor((times.length - 1) * 0.5)],
      firstP95Ms: times[Math.floor((times.length - 1) * 0.95)], loadMs: browser.loadMs,
      processRssStartBytes: memory[0]?.workingSetBytes ?? null,
      processRssMaximumObservedBytes: memory.length ? Math.max(...memory.map(x => x.workingSetBytes)) : null,
      gpuObserved: browser.gpuObserved, gpuQueueSubmissions: browser.gpu.queueSubmissions,
      nativeMaxAbsError: Math.max(...browser.referenceComparison.map(x => x.maxAbsError)),
      notes: "Single iteration per field; pretokenized tensors, local-loopback loading. Entire isolated Chromium process-set RSS sampled at milestones, not continuous peak or per-model physical RAM. GPU/CPU may be mixed.",
    });
  }
  const result = { schemaVersion: 1, status: "independently-recomputed-from-raw-scores", note: "All cases are consumed development data. Training and retrospective groups must not be pooled as accuracy.", groups, browserMeasurements, inputHashes: hashes };
  await writeFile(new URL("independent-audit.json", import.meta.url), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(groups, null, 2));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
