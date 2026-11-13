import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, writeFile, mkdir, readdir, stat, rename } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpus, totalmem, release, platform, arch } from "node:os";
import { validatePlan } from "../eval/dom-scale/runtime/contract.mjs";

const args = Object.fromEntries(process.argv.slice(2).map(value => { const at = value.indexOf("="); return [value.slice(2, at), value.slice(at + 1)]; }));
const mode = args.mode || "worker", provider = args.provider || "wasm", threads = Number(args.threads || 1);
if (!args.jobs || !args.model || !args.output || !["main", "worker"].includes(mode) || !["wasm", "webgpu"].includes(provider) || ![1, 2, 4].includes(threads)) throw new Error("--jobs --model --output required; --mode=main|worker --provider=wasm|webgpu --threads=1|2|4");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const bytes = await readFile(args.jobs), plan = validatePlan(JSON.parse(bytes));
const modelPath = resolve(args.model), modelBytes = await readFile(modelPath);
if (sha(modelBytes) !== plan.model.sha256) throw new Error("ONNX model hash mismatch");
const ortDir = resolve("eval/tiny-decision/slayer/node_modules/onnxruntime-web/dist");
const routes = { "/model.onnx": modelPath };
const sources = ["scripts/dom-scale-browser.mjs"];
if (provider === "wasm") for (const name of ["ort.wasm.min.mjs", "ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"]) sources.push(`eval/tiny-decision/slayer/node_modules/onnxruntime-web/dist/${name}`);
for (const name of ["contract.mjs", "inference.mjs", "worker.mjs", "page.mjs", "tokenize.mjs"]) {
  routes[`/${name}`] = resolve(`eval/dom-scale/runtime/${name}`);
  sources.push(`eval/dom-scale/runtime/${name}`);
}
for (const name of await readdir(ortDir)) if (/\.(wasm|mjs)$/.test(name)) routes[`/ort/${name}`] = resolve(ortDir, name);
if (args.tokenize === "on") {
  routes["/tokenizers.mjs"] = resolve("eval/dom-scale/runtime/node_modules/@huggingface/tokenizers/dist/tokenizers.mjs");
  const manifest = JSON.parse(await readFile("eval/dom-scale/model/tokenizer-manifest.json", "utf8"));
  for (const name of ["tokenizer.json", "tokenizer_config.json"]) {
    const file = manifest.files[name];
    if (sha(await readFile(file.path)) !== file.sha256) throw new Error("Tokenizer asset hash mismatch");
    routes[`/${name}`] = resolve(file.path);
  }
  sources.push("eval/dom-scale/runtime/package-lock.json", "eval/dom-scale/model/tokenizer-manifest.json", "eval/dom-scale/runtime/node_modules/@huggingface/tokenizers/dist/tokenizers.mjs");
}
const headers = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp", "Cache-Control": "no-store" };
const served = {};
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  if (path === "/plan.json") {
    res.writeHead(200, { ...headers, "Content-Type": "application/json" });
    res.end(JSON.stringify({ schemaVersion: 2, model: plan.model, cases: plan.cases, remoteCasePath: "/case/" })); return;
  }
  if (/^\/case\/\d+$/.test(path)) {
    const item = plan.cases[Number(path.split("/").at(-1))];
    if (!item) { res.writeHead(404, headers).end(); return; }
    const ids = new Set(item.batchIds);
    res.writeHead(200, { ...headers, "Content-Type": "application/json" });
    res.end(JSON.stringify({ schemaVersion: 2, model: plan.model, cases: [item], batches: plan.batches.filter(row => ids.has(row.id)), autoCases: (plan.autoCases || []).filter(row => row.id === item.id), reference: Object.fromEntries(Object.entries(plan.reference).filter(([id]) => ids.has(id))), tokenization: (plan.tokenization || []).filter(row => ids.has(row.batchId)) })); return;
  }
  if (path === "/") { res.writeHead(200, { ...headers, "Content-Type": "text/html" }); res.end('<!doctype html><title>DOM scale runtime evaluation</title><script type="module" src="/page.mjs"></script>'); return; }
  if (!routes[path]) { res.writeHead(404, headers).end(); return; }
  try {
    const size = (await stat(routes[path])).size;
    res.writeHead(200, { ...headers, "Content-Length": size, "Content-Type": path.endsWith(".mjs") ? "text/javascript" : path.endsWith(".wasm") ? "application/wasm" : "application/octet-stream" });
    const stream = createReadStream(routes[path]); stream.on("data", value => { served[path] = (served[path] || 0) + value.length; }); stream.pipe(res);
  } catch { res.writeHead(500, headers).end(); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const base = {
  schemaVersion: 2, startedAt: new Date().toISOString(), model: plan.model, modelBytes: modelBytes.length, modelSha256: sha(modelBytes), jobsSha256: sha(bytes),
  mode, provider, threads, arena: args.arena !== "off", memoryPattern: args["memory-pattern"] !== "off",
  tokenize: args.tokenize === "on",
  sourceSha256: Object.fromEntries(await Promise.all(sources.map(async path => [path, sha(await readFile(path))]))),
  runtime: "ONNX Runtime Web 1.31.1", externalRequests: [], processMemory: [],
  environment: { platform: platform(), osRelease: release(), arch: arch(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, physicalMemoryBytes: totalmem(), node: process.version },
  notes: [args.tokenize === "on" ? "Browser tokenizer regenerates every tensor with exact Python parity; DOM collection/template formatting excluded." : "Pretokenized input. DOM collection/tokenizer cost excluded.", "Local loopback asset loading; not internet-download timing.", "Whole isolated Chromium process-set working set, observed at milestones; not continuous peak or model-only physical RAM.", "Each field runs once. Chunk times summed per field; reporting/memory observation overhead excluded from inference.", "Worker teardown is an explicit lifecycle action after all cases, not implicit proof of background memory reclamation."],
};
await mkdir(dirname(resolve(args.output)), { recursive: true });
let browser, state = {};
const save = async patch => {
  state = { ...state, ...patch };
  const temporary = args.output + ".writing";
  await writeFile(temporary, JSON.stringify({ ...base, ...state, servedBytes: served }, null, 2) + "\n");
  for (let attempt = 0; ; attempt++) {
    try { await rename(temporary, args.output); return; }
    catch (error) { if (attempt >= 10) throw error; await new Promise(done => setTimeout(done, 50 * (attempt + 1))); }
  }
};
try {
  browser = await chromium.launch({ channel: "chromium", headless: true, args: ["--enable-precise-memory-info"] });
  base.environment.chromium = browser.version();
  const cdp = await browser.newBrowserCDPSession();
  const memory = async stage => {
    if (process.platform !== "win32") return;
    const info = await cdp.send("SystemInfo.getProcessInfo");
    const ids = info.processInfo.map(row => row.id).filter(id => Number.isSafeInteger(id) && id > 0);
    if (!ids.length) return;
    const command = `Get-Process -Id ${ids.join(",")} -ErrorAction SilentlyContinue | Select-Object Id,WorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress`;
    const parsed = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8", windowsHide: true, timeout: 10000 }));
    const processes = Array.isArray(parsed) ? parsed : [parsed];
    base.processMemory.push({ stage, workingSetBytes: processes.reduce((n, row) => n + row.WorkingSet64, 0), privateBytes: processes.reduce((n, row) => n + row.PrivateMemorySize64, 0), processes });
  };
  const page = await browser.newPage();
  await memory("before-page");
  await page.route("**/*", route => { const url = route.request().url(); if (url.startsWith(origin + "/")) return route.continue(); base.externalRequests.push(url); return route.abort(); });
  page.on("console", message => { if (["warning", "error"].includes(message.type())) console.log(message.type(), message.text().slice(0, 350)); });
  await page.exposeFunction("reportScaleProgress", async report => {
    if (report.stage !== "inference" || [1, Math.ceil(plan.cases.length / 2), plan.cases.length].includes(report.completedCases)) await memory(`${report.stage}-${report.completedCases}`);
    if (report.stage === "inference") {
      await save({ stage: report.stage, completedCases: report.completedCases, cases: [...(state.cases || []), report.case], rows: [...(state.rows || []), ...report.batchRows], referenceComparison: [...(state.referenceComparison || []), ...report.referenceRows] });
    } else await save(report);
    if (report.stage !== "inference" || report.completedCases % 12 === 0 || report.completedCases === plan.cases.length) console.log(JSON.stringify({ stage: report.stage, cases: report.completedCases, total: plan.cases.length }));
  });
  await page.goto(origin); await page.waitForFunction(() => typeof globalThis.runScale === "function");
  const report = await page.evaluate(options => globalThis.runScale(options), { mode, planUrl: "/plan.json", caseCount: plan.cases.length, provider, threads, arena: base.arena, memoryPattern: base.memoryPattern, tokenize: base.tokenize });
  await page.waitForTimeout(1000);
  await memory("one-second-after-release");
  await save({ ...report, finishedAt: new Date().toISOString() });
  if (report.cases.some(row => !row.valid) || !report.nativeReference.complete) process.exitCode = 1;
} catch (error) { await save({ error: String(error), finishedAt: new Date().toISOString() }); process.exitCode = 1; }
finally { await browser?.close(); await new Promise(done => server.close(done)); }
