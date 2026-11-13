import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { templates, v2Prompt } from "../eval/tiny-decision/v2/templates.mjs";
import {
  refinedTemplates,
  refinedPrompt,
} from "../eval/tiny-decision/v2/refined.mjs";
import { sampleDevelopment } from "../eval/tiny-decision/v2/sampling.mjs";
import { hash } from "../eval/tiny-decision/metrics.mjs";
const args = Object.fromEntries(
  process.argv.slice(2).map((s) => {
    const i = s.indexOf("=");
    return [s.slice(2, i), s.slice(i + 1)];
  }),
);
if (!args.output) throw new Error("--output required");
const inputPath =
  args.inputs || "eval/tiny-decision/v2/data/development-inputs.json";
const labelPath =
  args.labels || "eval/tiny-decision/v2/data/development-labels.json";
const inputs = JSON.parse(await readFile(inputPath, "utf8")),
  labels = JSON.parse(await readFile(labelPath, "utf8"));
const byId = new Map(labels.map((r) => [r.id, r]));
if (
  byId.size !== labels.length ||
  new Set(inputs.map((r) => r.id)).size !== inputs.length
)
  throw new Error("Duplicate case ID");
// A scoring sidecar cannot replace prompt inputs, field, split, options or question.
// Provenance is retained only for development stratification, never prompt rendering.
let rows = inputs.map((input) => {
  const label = byId.get(input.id);
  if (typeof label?.expectedId !== "string" || !label.expectedId)
    throw new Error("Every inference job needs a separate scoring label");
  return {
    ...input,
    expectedId: label.expectedId,
    acceptedIds: label.acceptedIds || [label.expectedId],
    provenance: label.provenance,
  };
});
const sampling = args.sample === "screen" ? sampleDevelopment(rows) : null;
if (sampling) rows = rows.filter((r) => sampling.selectedIds.includes(r.id));
const selected = args.templates ? args.templates.split(",") : templates;
const indexBase = Number(args["index-base"] ?? 1);
const cases = selected.flatMap((template) =>
  rows.map((row) => {
    const common = {
      id: row.id,
      split: row.split,
      field: row.field,
      template,
      indexBase,
      options: row.options.map((o) => ({ id: o.id, text: o.text })),
      expectedId: row.expectedId,
      acceptedIds: row.acceptedIds || [row.expectedId],
    };
    const build = refinedTemplates.includes(template)
      ? refinedPrompt
      : v2Prompt;
    const variants = [96, 72, 48, 32].map((textLimit) => ({
      textLimit,
      prompt: build(row, template, { textLimit, indexBase }),
    }));
    return {
      ...common,
      prompt: variants[0].prompt,
      promptVariants: variants,
      promptSha256: hash(variants[0].prompt),
    };
  }),
);
const result = {
  schemaVersion: 2,
  inputsSha256: hash(inputs),
  labelsSha256: hash(labels),
  templates: selected,
  sampling,
  preparedAt: new Date().toISOString(),
  cases,
};
await mkdir(dirname(args.output), { recursive: true });
await writeFile(args.output, JSON.stringify(result, null, 2) + "\n");
console.log(
  JSON.stringify({
    output: args.output,
    cases: cases.length,
    templates: selected,
    sample: sampling?.selectedIds,
  }),
);
