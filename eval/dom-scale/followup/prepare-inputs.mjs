import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { prepare } from "../model/representation.mjs";

const args = Object.fromEntries(process.argv.slice(2).map(x => { const i=x.indexOf("="); return [x.slice(2,i),x.slice(i+1)]; }));
if (!args.inputs || !args.output) throw new Error("--inputs=observed-inputs.json --output=directory required");
const bytes = await readFile(args.inputs), inputs = JSON.parse(bytes);
const sha = value => createHash("sha256").update(value).digest("hex");
const representationSha256 = sha(await readFile(new URL("../model/representation.mjs", import.meta.url)));
await mkdir(args.output, { recursive: true });
// Compact is reproduced only for the frozen whole-negative-page deduplication policy.
// The fourth model receives exactly the original natural input text and budget.
for (const source of ["full-natural", "full-compact"]) {
  const plan = prepare(inputs, source);
  if (source === "full-natural") {
    plan.recipe = "small-natural";
    plan.layers = [2, 5, 8, 11];
  }
  plan.inputsPath = args.inputs;
  plan.inputsSha256 = sha(bytes);
  plan.representationSha256 = representationSha256;
  await writeFile(`${args.output}/${plan.recipe}.json`, `${JSON.stringify(plan, null, 2)}\n`);
}
console.log(JSON.stringify({ cases: inputs.length, recipes: ["small-natural"], output: args.output }));
