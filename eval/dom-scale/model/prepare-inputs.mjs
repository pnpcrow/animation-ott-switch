import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { prepare, recipes } from "./representation.mjs";

const args = Object.fromEntries(process.argv.slice(2).map(x => { const i=x.indexOf("="); return [x.slice(2,i),x.slice(i+1)]; }));
if (!args.inputs || !args.output) throw new Error("--inputs=observed-inputs.json --output=directory required");
const bytes = await readFile(args.inputs), inputs = JSON.parse(bytes);
const sha = value => createHash("sha256").update(value).digest("hex");
await mkdir(args.output, { recursive: true });
for (const name of Object.keys(recipes)) {
  const plan = prepare(inputs, name);
  plan.inputsPath = args.inputs;
  plan.inputsSha256 = sha(bytes);
  plan.representationSha256 = sha(await readFile(new URL("representation.mjs", import.meta.url)));
  await writeFile(`${args.output}/${name}.json`, `${JSON.stringify(plan, null, 2)}\n`);
}
console.log(JSON.stringify({ cases: inputs.length, recipes: Object.keys(recipes), output: args.output }));
