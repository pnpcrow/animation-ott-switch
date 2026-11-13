import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

// Compatibility/latency workload only. Selection uses consumed development labels,
// never fresh predictions. The model's already-frozen template is preserved.
const args = Object.fromEntries(process.argv.slice(2).map(value => {
  const index = value.indexOf("=");
  return [value.slice(2, index), value.slice(index + 1)];
}));
if (!args.jobs || !args.output || !args.template) throw new Error("--jobs --output --template required");
const raw = await readFile(args.jobs);
const jobs = JSON.parse(raw);
const labels = JSON.parse(await readFile("eval/light-dom/data/development-labels.json", "utf8"));
const batches = [];
for (const field of ["title", "image", "description"]) {
  for (const positive of [true, false]) {
    const batch = jobs.batches.find(item => {
      if (!item.id.endsWith(`-${field}::${args.template}`)) return false;
      const id = item.id.slice(0, item.id.lastIndexOf("::"));
      const label = labels.find(value => value.id === id);
      return label && (label.expectedId !== "__none__") === positive;
    });
    if (!batch) throw new Error(`No planned ${field}/${positive ? "positive" : "none"} development batch`);
    batches.push({ ...batch, repeats: 3 });
  }
}
const result = {
  ...jobs,
  batches,
  reference: Object.fromEntries(batches.map(batch => [batch.id, jobs.reference[batch.id]])),
  subset: {
    policy: "First nonempty development batch per field and positive/none label in existing plan; no accuracy-based selection; 3 repeats each.",
    sourceBrowserJobsSha256: createHash("sha256").update(raw).digest("hex"),
    template: args.template,
  },
};
await writeFile(args.output, JSON.stringify(result) + "\n");
console.log(JSON.stringify({ batches: batches.map(row => row.id), output: args.output }));
