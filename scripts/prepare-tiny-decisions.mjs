import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { templates, decisionPrompt } from "../eval/tiny-decision/templates.mjs";
import { hash } from "../eval/tiny-decision/metrics.mjs";
const args = Object.fromEntries(
  process.argv.slice(2).map((x) => x.replace(/^--/, "").split("=")),
);
if (!args.dataset || !args.output)
  throw new Error("--dataset=path --output=path required");
const data = JSON.parse(await readFile(args.dataset, "utf8"));
const selected = args.template
  ? templates.filter((t) => t.id === args.template)
  : templates;
if (!selected.length) throw new Error("Unknown template");
const rows = (Array.isArray(data) ? data : data.cases).filter(
  (r) => r.split === (args.split || "calibration"),
);
if (!rows.length) throw new Error("No cases for requested split");
const cases = selected.flatMap((t) =>
  rows.map((r) => {
    if (!r.options?.some((o) => o.id === r.expectedId))
      throw new Error(`Invalid label ${r.id}`);
    const input = {
      id: r.id,
      split: r.split,
      scenario: r.scenario,
      document: r.document,
      question: r.question,
      options: r.options.map((o) => ({ id: o.id, text: o.text })),
    };
    return {
      ...input,
      template: t.id,
      indexBase: 1,
      prompt: decisionPrompt(input, t.id),
      expectedId: r.expectedId,
      acceptedIds: r.acceptedIds || [r.expectedId],
    };
  }),
);
await mkdir(dirname(args.output), { recursive: true });
await writeFile(
  args.output,
  JSON.stringify(
    {
      schemaVersion: 1,
      datasetSha256: hash(data),
      templateSha256: hash(selected),
      cases,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    output: args.output,
    cases: cases.length,
    split: args.split || "calibration",
    templates: selected.map((t) => t.id),
  }),
);
