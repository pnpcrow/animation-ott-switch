import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = "eval/dom-scale/runtime";
const read = async path => JSON.parse(await readFile(path, "utf8"));
const summary = await read(root + "/summary.json");
const gold = new Map((await read("eval/dom-scale/model/data/labels.json")).map(row => [row.id, row.acceptedIds?.length ? row.acceptedIds : [row.expectedId]]));
const design = await read("eval/dom-scale/model/design.json");
const expectedIds = [...design.split.validationIds].sort();
for (let round = 1; round <= 2; round++) {
 for (const batch of ["full", "micro2"]) {
  const path = `${root}/results/small-natural-worker-${batch}-r${round}.json`, result = await read(path);
  if (JSON.stringify(result.cases.map(row => row.id).sort()) !== JSON.stringify(expectedIds)) throw new Error("Supplemental validation denominator changed");
  const baseline = result.processMemory[0], peak = result.processMemory.reduce((a, b) => a.workingSetBytes > b.workingSetBytes ? a : b), final = result.processMemory.at(-1);
  summary.runs.push({ id: `small-natural-worker-${batch}`, recipe: "small-natural", round, path, sha256: createHash("sha256").update(await readFile(path)).digest("hex"), cases: result.cases.length, valid: result.cases.filter(row => row.valid).length, correct: result.cases.filter(row => row.valid && gold.get(row.id).includes(row.selected)).length, automaticNone: result.cases.filter(row => row.automaticNone).length, processing: result.processing, inference: result.inference, tokenizationAndInference: result.tokenizationAndInference, loadMs: result.loadMs, modelBytes: result.modelBytes, tokenizerLoadMs: result.tokenizerLoadMs, nativeReference: result.nativeReference, timer: result.mainThreadTimer, memory: { baselineBytes: baseline.workingSetBytes, sampledMaximumBytes: peak.workingSetBytes, sampledMaximumStage: peak.stage, baselineToMaximumBytes: peak.workingSetBytes - baseline.workingSetBytes, afterTerminationAndOneSecondBytes: final.workingSetBytes, retainedAboveBaselineBytes: final.workingSetBytes - baseline.workingSetBytes }, environment: result.environment });
 }
}
summary.notes.push("The small-natural follow-up was added from development results before blind prediction, and measured after the original counterbalanced rounds; additional order/thermal drift limitation applies.");
summary.generatedAt = new Date().toISOString();
await writeFile(root + "/all-summary.json", JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary.runs.map(row => ({ id: row.id, round: row.round, correct: row.correct, p50Ms: row.processing.p50Ms, p95Ms: row.processing.p95Ms, maxMiB: row.memory.sampledMaximumBytes / 1048576, afterMiB: row.memory.afterTerminationAndOneSecondBytes / 1048576 }))));
