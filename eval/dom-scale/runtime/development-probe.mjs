// Consumed prior experiment data, only for runtime development. Not an accuracy evaluation.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { validatePlan } from "./contract.mjs";
const old = JSON.parse(await readFile("eval/dom-adaptation/finetune/plans/browser-jobs.json", "utf8"));
await mkdir(".tmp/dom-scale/runtime", { recursive: true });
for (const size of [null, 2]) {
  const plan = { schemaVersion: 2, model: old.model, microbatch: size, cases: [], autoCases: [], batches: [], reference: {} };
  for (const source of old.batches.filter(row => /^(bebop-tving|tutu-laftel)-/.test(row.id))) {
    const candidateIds = source.pairIds.map(id => id.split("::")[1]);
    const item = { id: source.id, field: source.id.split("-").at(-1), candidateIds, batchIds: [] };
    for (let start = 0; start < candidateIds.length; start += size || candidateIds.length) {
      const count = Math.min(size || candidateIds.length, candidateIds.length - start);
      const oldWidth = source.inputs.input_ids.dims[1];
      let width = 1;
      for (let row = start; row < start + count; row++) {
        const mask = source.inputs.attention_mask.data.slice(row * oldWidth, (row + 1) * oldWidth);
        width = Math.max(width, mask.lastIndexOf(1) + 1);
      }
      const id = `${source.id}-${start}`;
      item.batchIds.push(id);
      plan.batches.push({ id, caseId: source.id, candidateIds: candidateIds.slice(start, start + count), pairIds: source.pairIds.slice(start, start + count), repeats: 1,
        inputs: Object.fromEntries(Object.entries(source.inputs).map(([name, input]) => [name, { ...input, dims: [count, width], data: Array.from({ length: count }, (_, i) => input.data.slice((start + i) * oldWidth, (start + i) * oldWidth + width)).flat() }])) });
      plan.reference[id] = old.reference[source.id].slice(start, start + count);
    }
    plan.cases.push(item);
  }
  validatePlan(plan);
  await writeFile(`.tmp/dom-scale/runtime/probe-${size || "full"}.json`, JSON.stringify(plan));
}
