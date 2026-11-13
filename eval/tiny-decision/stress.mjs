import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { optionText, shuffleOptions } from "./dataset.mjs";

export function makeStressVariants(rows, snapshots) {
  const lookup = new Map(snapshots.map((s) => [s.id, s]));
  const renamed = (node) => ({
    ...node,
    class: node.class
      ?.split(/\s+/)
      .map(
        (c) => "c_" + createHash("sha256").update(c).digest("hex").slice(0, 8),
      )
      .join(" "),
    parents: node.parents?.map(renamed),
  });
  return rows.flatMap((row) =>
    ["candidate-permutation", "class-rename"].map((transform) => {
      const snapshot = lookup.get(row.provenance.pageId);
      const options =
        transform === "candidate-permutation"
          ? shuffleOptions(row.options, `stress:${row.id}`)
          : row.options.map((o) => {
              if (o.id === "__none__") return { ...o };
              const candidate = snapshot.fields[row.field].find(
                (c) => c.id === o.id,
              );
              return {
                id: o.id,
                text: optionText(
                  { ...candidate, nodes: candidate.nodes.map(renamed) },
                  row.field,
                ),
              };
            });
      return {
        ...row,
        id: `${row.id}::${transform}`,
        provenance: {
          ...row.provenance,
          kind: "synthetic-layout-stress",
          baseCaseId: row.id,
          transform,
        },
        options,
        independentSample: false,
      };
    }),
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rows = JSON.parse(
    await readFile(
      new URL("./data/dom-selection.json", import.meta.url),
      "utf8",
    ),
  );
  const snapshots = JSON.parse(
    await readFile(
      new URL("./data/observations.json", import.meta.url),
      "utf8",
    ),
  );
  const variants = makeStressVariants(rows, snapshots);
  await writeFile(
    new URL("./data/dom-selection-stress.json", import.meta.url),
    JSON.stringify(variants, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      variants: variants.length,
      independentSamples: 0,
      holdoutVariants: variants.filter((x) => x.split === "holdout").length,
    }),
  );
}
