import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = "eval/dom-scale/runtime";
const read = async path => JSON.parse(await readFile(path, "utf8"));
const experiment = await read(root + "/experiment-plan.json");
const gold = new Map((await read("eval/dom-scale/model/data/labels.json")).map(row => [row.id, row.acceptedIds?.length ? row.acceptedIds : [row.expectedId]]));
const design = await read("eval/dom-scale/model/design.json");
const expectedIds = [...design.split.validationIds].sort();
const rows = [];
for (const config of experiment.configurations) {
  for (let round = 1; round <= experiment.rounds; round++) {
    const path = `${root}/results/${config.id}-r${round}.json`, result = await read(path);
    if (JSON.stringify(result.cases.map(row => row.id).sort()) !== JSON.stringify(expectedIds)) throw new Error("Validation denominator changed");
    const baseline = result.processMemory[0], peak = result.processMemory.reduce((a, b) => a.workingSetBytes > b.workingSetBytes ? a : b), final = result.processMemory.at(-1);
    rows.push({ id: config.id, recipe: config.recipe, round, path, sha256: createHash("sha256").update(await readFile(path)).digest("hex"), cases: result.cases.length, valid: result.cases.filter(row => row.valid).length, correct: result.cases.filter(row => row.valid && gold.get(row.id).includes(row.selected)).length, automaticNone: result.cases.filter(row => row.automaticNone).length, processing: result.processing, inference: result.inference, tokenizationAndInference: result.tokenizationAndInference, loadMs: result.loadMs, modelBytes: result.modelBytes, tokenizerLoadMs: result.tokenizerLoadMs, nativeReference: result.nativeReference, timer: result.mainThreadTimer, memory: { baselineBytes: baseline.workingSetBytes, sampledMaximumBytes: peak.workingSetBytes, sampledMaximumStage: peak.stage, baselineToMaximumBytes: peak.workingSetBytes - baseline.workingSetBytes, afterTerminationAndOneSecondBytes: final.workingSetBytes, retainedAboveBaselineBytes: final.workingSetBytes - baseline.workingSetBytes }, environment: result.environment });
  }
}
await writeFile(root + "/summary.json", JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), notes: ["Development-validation cohort, not the blind test.", "Two independent fresh-browser rounds in opposite order. Per-case latency percentiles are not population confidence intervals.", "Sampled working-set sums include browser overhead/shared-page double counting. Not continuous peak physical RAM.", "Complete field processing still excludes DOM collection/template construction, fixture I/O, load and reporting."], runs: rows }, null, 2) + "\n");
console.log(JSON.stringify(rows.map(row => ({ id: row.id, round: row.round, correct: row.correct, p50Ms: row.processing.p50Ms, p95Ms: row.processing.p95Ms, maxMiB: row.memory.sampledMaximumBytes / 1048576, afterMiB: row.memory.afterTerminationAndOneSecondBytes / 1048576 }))));
