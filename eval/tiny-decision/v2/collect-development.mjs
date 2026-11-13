import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parseHTML } from "linkedom";
import { enrichDomSnapshot } from "./collect.mjs";
const originals = JSON.parse(
  await readFile("eval/tiny-decision/data/observations.json", "utf8"),
);
const rows = JSON.parse(
  await readFile("eval/tiny-decision/data/dom-selection.json", "utf8"),
);
const snapshots = [];
for (const original of originals) {
  const html = await readFile(
    `.tmp/tiny-dom-captures/${original.id}.html`,
    "utf8",
  );
  const { document } = parseHTML(html);
  snapshots.push(enrichDomSnapshot(document, original.pageUrl, original));
}
const byId = new Map(snapshots.map((s) => [s.id, s]));
const inputs = rows.map((row) => {
  const s = byId.get(row.provenance.pageId);
  return {
    id: row.id,
    split: "development",
    field: row.field,
    question: row.question,
    document: row.document,
    pageEvidence: s.pageEvidence,
    options: row.options.map((option) => ({
      ...option,
      evidence:
        option.id === "__none__"
          ? null
          : s.fields[row.field].find((c) => c.id === option.id),
    })),
  };
});
const labels = rows.map((row) => ({
  id: row.id,
  split: "development",
  expectedId: row.expectedId,
  acceptedIds: row.acceptedIds,
  provenance: row.provenance,
  quality: row.quality,
}));
await mkdir("eval/tiny-decision/v2/data", { recursive: true });
for (const [name, data] of Object.entries({
  "development-observations": snapshots,
  "development-inputs": inputs,
  "development-labels": labels,
}))
  await writeFile(
    `eval/tiny-decision/v2/data/${name}.json`,
    JSON.stringify(data, null, 2) + "\n",
  );
console.log(
  JSON.stringify({
    cases: inputs.length,
    snapshots: snapshots.length,
    matchedNodes: snapshots
      .flatMap((s) =>
        Object.values(s.fields).flatMap((cs) => cs.flatMap((c) => c.nodes)),
      )
      .filter((n) => n.enrichmentMatched).length,
  }),
);
