import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export function removeDomContext(rows) {
  return rows
    .filter((row) => row.split === "holdout")
    .map((row) => ({
      ...row,
      id: `${row.id}::without-dom-context`,
      independentSample: false,
      provenance: {
        ...row.provenance,
        kind: "synthetic-context-ablation",
        baseCaseId: row.id,
        transform: "remove-ancestry-siblings-visibility-classes-roles",
      },
      options: row.options.map((option) =>
        option.id === "__none__"
          ? { ...option }
          : {
              id: option.id,
              text:
                option.text.match(/^value=("(?:\\.|[^"\\])*")/)?.[0] ||
                (() => {
                  throw new Error(`Missing value ${row.id}`);
                })(),
            },
      ),
    }));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rows = JSON.parse(
    await readFile(
      new URL("./data/dom-selection.json", import.meta.url),
      "utf8",
    ),
  );
  const ablations = removeDomContext(rows);
  await writeFile(
    new URL("./data/dom-selection-ablation.json", import.meta.url),
    JSON.stringify(ablations, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      pairedAblations: ablations.length,
      independentSamples: 0,
    }),
  );
}
