import { readFile, writeFile } from "node:fs/promises";
import { summarize } from "../eval/tiny-decision/metrics.mjs";

const baseline = JSON.parse(
  await readFile("eval/tiny-decision/results/slayer-holdout-raw.json", "utf8"),
);
const groups = [];
for (const name of ["index-one", "index-zero", "author-json"]) {
  const source = `eval/tiny-decision/results/slayer-${name}-raw.json`;
  const report = JSON.parse(await readFile(source, "utf8"));
  if (!report.finishedAt || report.rows.length !== 18)
    throw new Error(`Incomplete ${name}`);
  const valid = report.rows.filter((row) => row.valid);
  const masses = valid.map((row) => row.legalRootMass).sort((a, b) => a - b);
  if (masses.some((value) => !Number.isFinite(value)))
    throw new Error(`Missing raw root mass ${name}`);
  const paired = valid.filter((row) =>
    baseline.rows.some((other) => other.id === row.id && other.valid),
  );
  const nontrivial = valid.filter((row) => row.optionIds.length > 1);
  groups.push({
    name,
    source,
    label: report.label,
    independentValidation: false,
    summary: summarize(report.rows),
    legalRootMass: {
      count: masses.length,
      minimum: masses[0],
      median: masses[Math.floor((masses.length - 1) / 2)],
      mean: masses.reduce((sum, value) => sum + value, 0) / masses.length,
      maximum: masses.at(-1),
    },
    firstOption: {
      count: nontrivial.filter((row) => row.chosenId === row.optionIds[0])
        .length,
      nontrivialValid: nontrivial.length,
    },
    pairedWithOriginal: {
      commonlyValid: paired.length,
      sameChoice: paired.filter(
        (row) =>
          row.chosenId ===
          baseline.rows.find((other) => other.id === row.id).chosenId,
      ).length,
    },
  });
}
const output = {
  schemaVersion: 1,
  note: "Fixed post-hoc prompt-format controls on the same 18 holdout cases. Not additional independent validation, no template reselection. Conditional choice confidence is distinct from unconditioned root mass.",
  groups,
};
await writeFile(
  "eval/tiny-decision/results/slayer-format-controls.json",
  JSON.stringify(output, null, 2) + "\n",
);
console.log(JSON.stringify(output, null, 2));
