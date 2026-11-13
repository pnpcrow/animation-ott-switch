import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { v2Prompt } from "../eval/tiny-decision/v2/templates.mjs";
import { refinedTemplates, refinedPrompt } from "../eval/tiny-decision/v2/refined.mjs";

const args = Object.fromEntries(process.argv.slice(2).map(s => { const i = s.indexOf("="); return [s.slice(2, i), s.slice(i + 1)]; }));
if (!args.output) throw new Error("--output=path required");
const freeze = JSON.parse(await readFile("eval/tiny-decision/v2/global-freeze.json", "utf8"));
if (!freeze.lockedAt) throw new Error("Global development freeze required");
const digest = b => createHash("sha256").update(b).digest("hex");
for (const [path, expected] of Object.entries(freeze.sources)) {
  if (digest(await readFile(path)) !== expected) throw new Error(`Frozen source changed: ${path}`);
}
const selectionBytes = await readFile(freeze.selections.jev.path);
if (digest(selectionBytes) !== freeze.selections.jev.sha256) throw new Error("Jev selection changed");
const template = JSON.parse(selectionBytes).selectedTemplates[0];
const inputs = JSON.parse(await readFile("eval/tiny-decision/v2/data/holdout-inputs.json", "utf8"));
const labels = JSON.parse(await readFile("eval/tiny-decision/v2/data/holdout-labels.json", "utf8"));
const byId = new Map(labels.map(row => [row.id, row]));
const groups = [
  { template, reverse: false },
  ...(template === "legacy-enriched" ? [] : [{ template: "legacy-enriched", reverse: false }]),
  { template, reverse: true },
];
const cases = groups.flatMap(group => inputs.map(input => {
  const label = byId.get(input.id);
  if (!label) throw new Error("Missing label");
  const row = { ...input, options: group.reverse ? [...input.options].reverse() : input.options };
  const build = refinedTemplates.includes(group.template) ? refinedPrompt : v2Prompt;
  const variants = [96, 72, 48, 32].map(textLimit => ({ textLimit, prompt: build(row, group.template, { textLimit, indexBase: 1 }) }));
  return {
    id: input.id + (group.reverse ? "::reverse" : ""),
    split: "holdout", field: row.field, template: group.template, indexBase: 1,
    options: row.options.map(({ id, text }) => ({ id, text })),
    expectedId: label.expectedId, acceptedIds: label.acceptedIds || [label.expectedId],
    prompt: variants[0].prompt, promptVariants: variants,
  };
}));
await mkdir(dirname(args.output), { recursive: true });
await writeFile(args.output, JSON.stringify({ schemaVersion: 2, globalFreeze: freeze, cases }, null, 2) + "\n");
console.log(JSON.stringify({ template, cases: cases.length, output: args.output }));
