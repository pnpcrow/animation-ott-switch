import { readFile, writeFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
const output = "eval/dom-scale/runtime/source-freeze.json";
try { await access(output); throw new Error("Refuse to overwrite runtime freeze"); } catch (error) { if (error.code !== "ENOENT") throw error; }
const paths = ["scripts/dom-scale-browser.mjs", ...["contract.mjs", "inference.mjs", "page.mjs", "worker.mjs", "tokenize.mjs", "benchmark.mjs", "summarize.mjs", "freeze.mjs", "experiment-plan.json", "package-lock.json"].map(name => "eval/dom-scale/runtime/" + name), "eval/dom-scale/model/tokenizer-manifest.json", "eval/dom-scale/runtime/node_modules/@huggingface/tokenizers/dist/tokenizers.mjs", "eval/tiny-decision/slayer/package-lock.json"];
for (const name of ["ort.wasm.min.mjs", "ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"]) paths.push(`eval/tiny-decision/slayer/node_modules/onnxruntime-web/dist/${name}`);
const hashes = Object.fromEntries(await Promise.all(paths.map(async path => [path, createHash("sha256").update(await readFile(path)).digest("hex")])));
await writeFile(output, JSON.stringify({ schemaVersion: 1, frozenAt: new Date().toISOString(), holdoutOutputsInspected: false, hashes }, null, 2) + "\n");
console.log(JSON.stringify({ frozen: paths.length, output }));
