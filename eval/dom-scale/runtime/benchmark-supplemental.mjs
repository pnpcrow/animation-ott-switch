import { readFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
const root = "eval/dom-scale/runtime";
const freeze = JSON.parse(await readFile(root + "/source-freeze.json", "utf8"));
for (const [path, hash] of Object.entries(freeze.hashes)) if (createHash("sha256").update(await readFile(path)).digest("hex") !== hash) throw new Error("Runtime source changed: " + path);
const exports = JSON.parse(await readFile("eval/dom-scale/followup/exports.json", "utf8"));
const model = exports.models.find(row => row.recipe === "small-natural");
for (let round = 1; round <= 2; round++) {
 for (const batch of round === 1 ? ["full", "micro2"] : ["micro2", "full"]) {
  const output = `${root}/results/small-natural-worker-${batch}-r${round}.json`;
  try { await access(output); throw new Error("Refuse to overwrite benchmark: " + output); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const result = spawnSync(process.execPath, ["scripts/dom-scale-browser.mjs", `--jobs=eval/dom-scale/followup/browser-plans/small-natural-${batch}.json`, `--model=${model.modelPath}`, `--output=${output}`, "--mode=worker", "--provider=wasm", "--threads=1", "--tokenize=on"], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Supplemental benchmark failed (${result.status}): ${output}`);
 }
}
