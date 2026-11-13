import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { preparePairs, templates } from "../eval/light-dom/templates.mjs";
const args = Object.fromEntries(process.argv.slice(2).map(s => { const i = s.indexOf("="); return [s.slice(2, i), s.slice(i + 1)]; }));
if (!args.output) throw new Error("--output=path required");
const inputPath = args.inputs || "eval/light-dom/data/development-inputs.json";
if (inputPath.includes("holdout")) {
  const freeze = JSON.parse(await readFile("eval/light-dom/freeze.json", "utf8"));
  if (!freeze.lockedAt) throw new Error("Global model/settings freeze required before fresh input preparation");
}
const inputBytes = await readFile(inputPath);
const jobs = preparePairs(JSON.parse(inputBytes), args.templates?.split(",") || templates);
jobs.inputsSha256 = createHash("sha256").update(inputBytes).digest("hex");
jobs.inputPath = inputPath;
jobs.preparedAt = new Date().toISOString();
jobs.templateSha256 = createHash("sha256").update(await readFile("eval/light-dom/templates.mjs")).digest("hex");
await mkdir(dirname(args.output), { recursive: true });
await writeFile(args.output, JSON.stringify(jobs, null, 2) + "\n");
console.log(JSON.stringify({ cases: jobs.cases.length, pairs: jobs.pairs.length, maxTokens: jobs.maxTokens, output: args.output }));
