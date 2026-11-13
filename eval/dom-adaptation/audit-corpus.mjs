import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { corpusRecords, summarize, providerHeldoutFolds } from "./protocol.mjs";

const root = new URL("../../", import.meta.url);
const read = async path => {
  const bytes = await readFile(new URL(path, root));
  return { path, sha256: createHash("sha256").update(bytes).digest("hex"), rows: JSON.parse(bytes) };
};
const files = await Promise.all(["development", "holdout"].flatMap(part => ["inputs", "labels"].map(kind => read(`eval/light-dom/data/${part}-${kind}.json`))));
const records = corpusRecords([...files[0].rows, ...files[2].rows], [...files[1].rows, ...files[3].rows]);
const report = {
  schemaVersion: 1,
  status: "consumed-development-only",
  note: "These folds have not been trained or evaluated. They define provider- and work-disjoint development experiments, not a new untouched benchmark.",
  sources: files.map(({ path, sha256 }) => ({ path, sha256 })),
  summary: summarize(records),
  perProvider: [...new Set(records.map(x => x.provider))].sort().map(provider => ({ provider, ...summarize(records.filter(x => x.provider === provider)) })),
  folds: providerHeldoutFolds(records),
};
const output = new URL("corpus-audit.json", import.meta.url);
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report.summary, folds: report.folds.length, incompleteTwoSidedFolds: report.folds.filter(x => !x.canMeasureBothPositiveAndAbsent).map(x => x.provider) }, null, 2));
