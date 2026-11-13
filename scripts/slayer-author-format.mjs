import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const data = JSON.parse(await readFile(".tmp/slayer-holdout.json", "utf8"));
const label =
  "Post-hoc fixed model-card-style JSON format sensitivity; same18holdoutcases, not independent validation";
for (const row of data.cases) {
  delete row.prompt;
  row.indexBase = 0;
  row.template = "author-json-zero";
}
data.purpose = label;
// With no override prompt, run.py builds the model-card-style state/question/
// options JSON using Python json.dumps(ensure_ascii=False), and the published
// English instruction and Best answer: [ suffix. It remains fixed for all rows.
await writeFile(
  ".tmp/slayer-author-json.json",
  JSON.stringify(data, null, 2) + "\n",
);
const execute = (command, args) =>
  new Promise((done, reject) => {
    const child = spawn(command, args, { stdio: "inherit", windowsHide: true });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? done() : reject(new Error(`Process failed ${code}`)),
    );
  });
await execute(resolve(".tmp/slayer-venv/Scripts/python.exe"), [
  "eval/tiny-decision/slayer/run.py",
  "--jobs",
  ".tmp/slayer-author-json.json",
  "--output",
  "eval/tiny-decision/results/slayer-author-json-raw.json",
  "--threads",
  "4",
  "--label",
  label,
]);
await execute(process.execPath, [
  "scripts/slayer-report.mjs",
  "--input=eval/tiny-decision/results/slayer-author-json-raw.json",
  "--output=eval/tiny-decision/results/slayer-author-json.json",
]);
