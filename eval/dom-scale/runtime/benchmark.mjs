import { readFile, access, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
const root = "eval/dom-scale/runtime";
const experiment = JSON.parse(await readFile(root + "/experiment-plan.json", "utf8"));
const freeze = JSON.parse(await readFile(root + "/source-freeze.json", "utf8"));
for (const [path, hash] of Object.entries(freeze.hashes)) if (createHash("sha256").update(await readFile(path)).digest("hex") !== hash) throw new Error("Runtime source changed: " + path);
const exports = JSON.parse(await readFile("eval/dom-scale/model/exports.json", "utf8"));
await mkdir(root + "/results", { recursive: true });
for (let round = 1; round <= experiment.rounds; round++) {
  const configs = round % 2 ? experiment.configurations : [...experiment.configurations].reverse();
  for (const config of configs) {
    const output = `${root}/results/${config.id}-r${round}.json`;
    try { await access(output); throw new Error("Refuse to overwrite benchmark: " + output); } catch (error) { if (error.code !== "ENOENT") throw error; }
    const model = exports.models.find(row => row.recipe === config.recipe);
    const args = ["scripts/dom-scale-browser.mjs", `--jobs=eval/dom-scale/model/browser-plans/${config.recipe}-${config.batch}.json`, `--model=${model.modelPath}`, `--output=${output}`, `--mode=${config.mode}`, "--provider=wasm", "--threads=1", "--tokenize=on"];
    console.log(JSON.stringify({ benchmark: config.id, round }));
    const result = spawnSync(process.execPath, args, { stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Benchmark failed (${result.status}): ${output}`);
  }
}
