import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const locked = JSON.parse(
  await readFile("eval/tiny-decision/results/slayer-calibration.json", "utf8"),
).selection;
if (!locked?.template || !locked.lockedAt)
  throw new Error("Complete and lock calibration before sensitivity runs");
const python = resolve(".tmp/slayer-venv/Scripts/python.exe");
const execute = (command, args) =>
  new Promise((done, reject) => {
    const child = spawn(command, args, { stdio: "inherit", windowsHide: true });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? done() : reject(new Error(`Process failed: ${code}`)),
    );
  });
for (const [name, dataset, label] of [
  [
    "compact",
    "dom-selection-compact",
    "Paired compact-input sensitivity; not independent validation",
  ],
  [
    "challenge",
    "synthetic-challenge",
    "Separate synthetic challenge; not live-site accuracy",
  ],
  [
    "ablation",
    "dom-selection-ablation",
    "Paired removal of DOM context; not independent validation",
  ],
  [
    "stress",
    "dom-selection-stress",
    "Paired candidate-permutation and CSS-class stress; not independent validation",
  ],
]) {
  const jobs = `.tmp/slayer-${name}.json`;
  const output = `eval/tiny-decision/results/slayer-${name}-raw.json`;
  await execute(process.execPath, [
    "scripts/prepare-tiny-decisions.mjs",
    `--dataset=eval/tiny-decision/data/${dataset}.json`,
    `--output=${jobs}`,
    "--split=holdout",
    `--template=${locked.template}`,
  ]);
  await execute(python, [
    "eval/tiny-decision/slayer/run.py",
    "--jobs",
    jobs,
    "--output",
    output,
    "--threads",
    "4",
    "--label",
    label,
  ]);
  await execute(process.execPath, [
    "scripts/slayer-report.mjs",
    `--input=${output}`,
    `--output=eval/tiny-decision/results/slayer-${name}.json`,
  ]);
}
