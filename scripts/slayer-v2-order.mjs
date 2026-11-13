import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { sampleDevelopment } from "../eval/tiny-decision/v2/sampling.mjs";
import { v2Prompt } from "../eval/tiny-decision/v2/templates.mjs";
import { hash, summarize } from "../eval/tiny-decision/metrics.mjs";

const root = "eval/tiny-decision/v2/slayer";
const read = async (file) => JSON.parse(await readFile(file, "utf8"));
const selection = await read(`${root}/selection.json`);
const development = await read(`${root}/development.json`);
if (
  !selection.selectedAt ||
  selection.selectedTemplates.length !== 1 ||
  !development.finishedAt
)
  throw new Error("Completed development and one frozen template are required");
const template = selection.selectedTemplates[0];
const inputs = await read("eval/tiny-decision/v2/data/development-inputs.json");
const labels = await read("eval/tiny-decision/v2/data/development-labels.json");
const rows = inputs.map((input) => ({
  ...input,
  ...labels.find((label) => label.id === input.id),
}));
if (rows.some((row) => row.split !== "development"))
  throw new Error("Development only");
const sampling = sampleDevelopment(rows);
const ids = sampling.selectedIds.filter((_, index) => index % 2 === 0);
const cases = ids.map((id) => {
  const row = rows.find((item) => item.id === id);
  const reversed = { ...row, options: [...row.options].reverse() };
  const promptVariants = [96, 72, 48, 32].map((textLimit) => ({
    textLimit,
    prompt: v2Prompt(reversed, template, { textLimit, indexBase: 0 }),
  }));
  return {
    id,
    split: "development",
    field: row.field,
    template,
    indexBase: 0,
    options: reversed.options.map((option) => ({
      id: option.id,
      text: option.text,
    })),
    expectedId: row.expectedId,
    acceptedIds: row.acceptedIds || [row.expectedId],
    prompt: promptVariants[0].prompt,
    promptVariants,
  };
});
const jobsFile = `${root}/order-jobs.json`,
  inferenceFile = `${root}/order-inference.json`;
await writeFile(
  jobsFile,
  JSON.stringify(
    {
      schemaVersion: 2,
      templates: [template],
      cases,
      sampling: {
        selectedIds: ids,
        policy:
          "First case from each predeclared screen stratum: field x positive/none; no predictions enter sampling. Reverse all options, keeping observed facts and frozen template.",
      },
    },
    null,
    2,
  ) + "\n",
);
await new Promise((resolve, reject) => {
  const child = spawn(
    process.execPath,
    [
      "scripts/slayer-v2-eval.mjs",
      `--jobs=${jobsFile}`,
      `--output=${inferenceFile}`,
    ],
    { stdio: "inherit", shell: false },
  );
  child.on("error", reject);
  child.on("exit", (code) =>
    code === 0 ? resolve() : reject(new Error(`Inference exited ${code}`)),
  );
});
const reversed = await read(inferenceFile);
const original = ids.map((id) =>
  development.rows.find((row) => row.id === id && row.template === template),
);
const paired = reversed.rows.map((row) => {
  const before = original.find((item) => item.id === row.id);
  return {
    id: row.id,
    bothValid: row.valid && before.valid,
    original: before.chosenId,
    reversed: row.chosenId,
    sameChoice: row.valid && before.valid && row.chosenId === before.chosenId,
  };
});
const result = {
  schemaVersion: 2,
  template,
  selectionSha256: hash(selection),
  selectionTime: selection.selectedAt,
  cohort:
    "Development-only paired order sensitivity; not independent holdout and not used for template reselection",
  original: summarize(original),
  reversed: summarize(reversed.rows),
  paired,
  validPairs: paired.filter((row) => row.bothValid).length,
  sameChoices: paired.filter((row) => row.sameChoice).length,
  finishedAt: new Date().toISOString(),
};
await writeFile(`${root}/order.json`, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
