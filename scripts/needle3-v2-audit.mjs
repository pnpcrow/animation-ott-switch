import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { unknownToolNames } from "../eval/tiny-decision/v2/needle/choice-guard.mjs";
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const index = arg.indexOf("=");
    return [arg.slice(2, index), arg.slice(index + 1)];
  }),
);
if (!args.input || !args.output)
  throw new Error("--input=completed.json --output=audit.json required");
const bytes = await readFile(args.input);
const report = JSON.parse(bytes);
if (!report.finishedAt || report.error)
  throw new Error("Completed successful report required");
const rows = report.runs.flatMap((run) =>
  run.rows.map((row) => ({ ...row, template: run.template })),
);
const unknown = rows.flatMap((row) =>
  [false, true].flatMap((suppressed) =>
    unknownToolNames(row.result, row.request.tools, { suppressed }).map(
      (name) => ({ id: row.id, template: row.template, suppressed, name }),
    ),
  ),
);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const audit = {
  source: args.input,
  sourceSha256: sha(bytes),
  auditedAt: new Date().toISOString(),
  rows: rows.length,
  unknown,
  passes: unknown.length === 0,
  choiceGuardSha256: sha(
    await readFile("eval/tiny-decision/v2/needle/choice-guard.mjs"),
  ),
  boundary:
    "Exact request-schema tool-name membership only. No model calls, prompt changes, confidence changes or selection changes. Zero unknown names proves the new guard would not reject any prior output beyond the existing parser.",
};
await writeFile(args.output, JSON.stringify(audit, null, 2) + "\n");
console.log(JSON.stringify(audit));
if (!audit.passes) process.exitCode = 1;
