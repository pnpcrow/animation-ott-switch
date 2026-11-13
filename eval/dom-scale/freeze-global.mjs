import { readFile, writeFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
const output = "eval/dom-scale/global-freeze.json";
try { await access(output); throw new Error("Refuse to overwrite global freeze"); } catch (error) { if (error.code !== "ENOENT") throw error; }
const paths = [
  "freeze-global.mjs", "audit.mjs", "collection-train/collection-manifest.json",
  "model/model-freeze.json", "model/exports.json", "followup/source-wrapper-manifest.json", "followup/model-freeze.json", "followup/exports.json", "followup/selection.json",
  "runtime/source-freeze.json", "runtime/initial-source-freeze.json", "runtime/experiment-plan.json", "runtime/supplemental-plan.json", "runtime/supplemental-plan.initial.json", "runtime/benchmark-supplemental.mjs", "runtime/summarize-all.mjs",
  "holdout/data-freeze.json", "holdout/reserved-work-hashes.json", "holdout/evaluation-plan.json", "holdout/score.mjs", "holdout/browser-evaluation-plan.json", "holdout/score-browser.mjs", "holdout/supplemental-evaluation-plan.json", "holdout/score-supplemental.mjs",
].map(path => "eval/dom-scale/" + path);
const hashes = Object.fromEntries(await Promise.all(paths.map(async path => [path, createHash("sha256").update(await readFile(path)).digest("hex")])));
const selection = JSON.parse(await readFile("eval/dom-scale/followup/selection.json", "utf8"));
if (selection.selected !== "small-natural") throw new Error("Unexpected development selection; examine the pre-test plan");
await writeFile(output, JSON.stringify({ schemaVersion: 1, frozenAt: new Date().toISOString(), holdoutPredictionsStarted: false, holdoutInputsOrGoldInspectedByModelAuthors: false, selectionBasis: selection.basis, selectedRecipe: selection.selected, selectedBrowser: { batch: "full", mode: "worker", provider: "wasm", threads: 1, tokenize: true }, reasonForSupplementalBatch: "Development-only q8 full 42/57 versus micro2 40/57; retain both as reported conditions, select full before blind predictions.", originalThreeRecipesRetained: true, fourthRecipeAddedAfterDevelopmentOnly: true, hashes }, null, 2) + "\n");
console.log(JSON.stringify({ output, hashes: paths.length, selected: selection.selected }));
