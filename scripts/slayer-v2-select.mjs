import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
const args = Object.fromEntries(
  process.argv.slice(2).map((s) => {
    const i = s.indexOf("=");
    return [s.slice(2, i), s.slice(i + 1)];
  }),
);
if (!args.input || !args.output)
  throw new Error(
    "--input=completed-report.json --output=selection.json [--count=1|2]",
  );
const source = await readFile(args.input, "utf8"),
  report = JSON.parse(source);
if (!report.finishedAt || !report.rows?.length)
  throw new Error("Selection requires a completed native run");
if (
  report.rows.some(
    (row) => !["development", "calibration", "screen"].includes(row.split),
  )
)
  throw new Error("Fresh holdout cannot be used for template selection");
const count = Number(args.count || 1);
if (![1, 2].includes(count))
  throw new Error("Select one global winner or two screening finalists");
const rank = (a, b) =>
  b.summary.accuracy - a.summary.accuracy ||
  a.summary.falseSelections - b.summary.falseSelections ||
  b.summary.valid - a.summary.valid ||
  a.template.localeCompare(b.template);
const ranked = [...report.summaries].sort(rank);
const sets = ranked.map((row) =>
  report.rows
    .filter((x) => x.template === row.template)
    .map((x) => x.id)
    .sort(),
);
if (
  sets.some(
    (ids) =>
      JSON.stringify(ids) !== JSON.stringify(sets[0]) ||
      new Set(ids).size !== ids.length,
  )
)
  throw new Error("Templates did not evaluate the same unique cases");
const sourceSha256 = createHash("sha256").update(source).digest("hex");
const selection = {
  schemaVersion: 2,
  model: report.model,
  source: args.input,
  sourceSha256,
  selectedAt: new Date().toISOString(),
  policy:
    "Highest development accuracy, then fewer false element selections, more valid outputs, stable template ID. Latency is excluded because of reuse and concurrent loads.",
  selectedTemplates: ranked.slice(0, count).map((row) => row.template),
  ranked,
  fieldDiagnostics: Object.fromEntries(
    ["title", "image", "description"].map((field) => {
      const ranks = report.summaries
        .map((row) => ({ template: row.template, summary: row.fields[field] }))
        .sort(rank);
      return [
        field,
        {
          winner: ranks[0].template,
          ranked: ranks,
          note: "Development-only diagnostic, not selected by fresh holdout or deployed as field-specific routing.",
        },
      ];
    }),
  ),
  automaticNavigation: false,
};
await mkdir(dirname(args.output), { recursive: true });
try {
  const previous = JSON.parse(await readFile(args.output, "utf8"));
  if (
    previous.sourceSha256 !== sourceSha256 ||
    JSON.stringify(previous.selectedTemplates) !==
      JSON.stringify(selection.selectedTemplates)
  )
    throw new Error(
      "Existing selection lock differs; choose a separate output path",
    );
  selection.selectedAt = previous.selectedAt;
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await writeFile(args.output, JSON.stringify(selection, null, 2) + "\n");
console.log(
  JSON.stringify({
    selectedTemplates: selection.selectedTemplates,
    selectedAt: selection.selectedAt,
    ranked: selection.ranked,
  }),
);
