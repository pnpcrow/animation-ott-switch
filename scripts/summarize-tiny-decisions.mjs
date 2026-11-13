import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  summarize,
  selectTemplate,
  hash,
} from "../eval/tiny-decision/metrics.mjs";
const args = Object.fromEntries(
  process.argv.slice(2).map((x) => x.replace(/^--/, "").split("=")),
);
if (!args.report || !args.output)
  throw new Error("--report=path --output=path required");
const raw = JSON.parse(await readFile(args.report, "utf8"));
const rows = raw.results || raw.rows;
if (!rows?.length || !raw.finishedAt)
  throw new Error("Only completed non-empty model runs can be summarized");
const summaries = [...new Set(rows.map((r) => `${r.split}|${r.template}`))].map(
  (key) => {
    const [split, template] = key.split("|");
    return {
      split,
      template,
      summary: summarize(
        rows.filter((r) => r.split === split && r.template === template),
      ),
    };
  },
);
const output = { model: raw.model, sourceSha256: hash(raw), summaries };
if (args.select === "calibration") {
  if (rows.some((r) => r.split !== "calibration"))
    throw new Error(
      "Template selection input must contain calibration rows only",
    );
  const groups = new Map();
  for (const row of rows) {
    const ids = groups.get(row.template) || [];
    ids.push(row.id);
    groups.set(row.template, ids);
  }
  const signatures = [...groups.values()].map((ids) => {
    if (new Set(ids).size !== ids.length)
      throw new Error("Duplicate calibration cases");
    return ids.sort().join("\n");
  });
  if (new Set(signatures).size !== 1)
    throw new Error("Templates must use identical complete calibration cases");
  output.selection = {
    ...selectTemplate(summaries),
    lockedAt: new Date().toISOString(),
  };
}
await mkdir(dirname(args.output), { recursive: true });
await writeFile(args.output, JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify(output));
