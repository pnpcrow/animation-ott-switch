import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { sampleDevelopment } from "../eval/tiny-decision/v2/sampling.mjs";
import {
  binaryPrompt,
  pointwiseProtocol,
} from "../eval/tiny-decision/v2/slayer/pointwise.mjs";
import { hash } from "../eval/tiny-decision/metrics.mjs";
const args = Object.fromEntries(
  process.argv.slice(2).map((s) => {
    const i = s.indexOf("=");
    return [s.slice(2, i), s.slice(i + 1)];
  }),
);
if (!args.output) throw new Error("--output=path required");
const inputs = JSON.parse(
  await readFile(
    args.inputs || "eval/tiny-decision/v2/data/development-inputs.json",
    "utf8",
  ),
);
const labels = JSON.parse(
  await readFile(
    args.labels || "eval/tiny-decision/v2/data/development-labels.json",
    "utf8",
  ),
);
const gold = new Map(labels.map((row) => [row.id, row]));
let rows = inputs.map((row) => ({ ...row, ...gold.get(row.id) }));
const sampling = args.sample === "screen" ? sampleDevelopment(rows) : null;
if (sampling)
  rows = rows.filter((row) => sampling.selectedIds.includes(row.id));
const cases = [];
for (const row of rows)
  for (const candidate of row.options.filter(
    (option) => option.id !== "__none__",
  ))
    for (const order of [0, 1]) {
      const yes = { id: "qualifies", text: "The candidate qualifies." },
        no = {
          id: "does-not-qualify",
          text: "The candidate does not qualify.",
        };
      const variants = [96, 72, 48, 32].map((textLimit) => ({
        textLimit,
        prompt: binaryPrompt(row, candidate.id, order, textLimit),
      }));
      const expectedId = (row.acceptedIds || [row.expectedId]).includes(
        candidate.id,
      )
        ? yes.id
        : no.id;
      cases.push({
        id: `${row.id}::${candidate.id}::order-${order}`,
        parentCaseId: row.id,
        candidateId: candidate.id,
        labelOrder: order,
        field: row.field,
        split: row.split,
        template: "symmetric-pointwise",
        indexBase: 0,
        options: order === 0 ? [yes, no] : [no, yes],
        prompt: variants[0].prompt,
        promptVariants: variants,
        expectedId,
        acceptedIds: [expectedId],
      });
    }
const result = {
  schemaVersion: 2,
  protocol: pointwiseProtocol,
  inputsSha256: hash(inputs),
  labelsSha256: hash(labels),
  sampling,
  templates: ["symmetric-pointwise"],
  parentCases: rows.map((row) => ({
    id: row.id,
    field: row.field,
    split: row.split,
    options: row.options.map((option) => ({ id: option.id })),
    expectedId: row.expectedId,
    acceptedIds: row.acceptedIds || [row.expectedId],
  })),
  cases,
};
await mkdir(dirname(args.output), { recursive: true });
await writeFile(args.output, JSON.stringify(result, null, 2) + "\n");
console.log(
  JSON.stringify({
    parents: rows.length,
    candidateCalls: cases.length,
    output: args.output,
  }),
);
