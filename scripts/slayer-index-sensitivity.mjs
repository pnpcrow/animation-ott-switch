import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const source = JSON.parse(await readFile(".tmp/slayer-holdout.json", "utf8"));
const selection = JSON.parse(
  await readFile("eval/tiny-decision/results/slayer-calibration.json", "utf8"),
).selection;
if (
  !source.cases.every(
    (row) => row.template === selection.template && row.indexBase === 1,
  )
)
  throw new Error("Expected unchanged locked shared holdout jobs");
const answerEnding =
  "\n\nSelect one option. Answer only with its bracketed numeric identifier.\n\nBest answer: [";
const zero = {
  ...source,
  cases: source.cases.map((row) => {
    const before =
      "\n\nOptions:\n" +
      row.options
        .map((option, index) => `[${index + 1}] ${option.text}`)
        .join("\n") +
      answerEnding;
    const after =
      "\n\nOptions:\n" +
      row.options
        .map((option, index) => `[${index}] ${option.text}`)
        .join("\n") +
      answerEnding;
    if (!row.prompt.endsWith(before))
      throw new Error("Unrecognized frozen option suffix");
    return {
      ...row,
      indexBase: 0,
      prompt: row.prompt.slice(0, -before.length) + after,
    };
  }),
};
await writeFile(
  ".tmp/slayer-index-zero.json",
  JSON.stringify(zero, null, 2) + "\n",
);
const execute = (command, args) =>
  new Promise((done, reject) => {
    const child = spawn(command, args, { stdio: "inherit", windowsHide: true });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? done() : reject(new Error(`Process failed ${code}`)),
    );
  });
for (const [name, path] of [
  ["zero", ".tmp/slayer-index-zero.json"],
  ["one", ".tmp/slayer-holdout.json"],
]) {
  const output = `eval/tiny-decision/results/slayer-index-${name}-raw.json`;
  await execute(resolve(".tmp/slayer-venv/Scripts/python.exe"), [
    "eval/tiny-decision/slayer/run.py",
    "--jobs",
    path,
    "--output",
    output,
    "--threads",
    "4",
    "--label",
    `Post-hoc index-${name} sensitivity with fixed template; repeated holdout, not independent validation`,
  ]);
  await execute(process.execPath, [
    "scripts/slayer-report.mjs",
    `--input=${output}`,
    `--output=eval/tiny-decision/results/slayer-index-${name}.json`,
  ]);
}
