import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
const args = Object.fromEntries(process.argv.slice(2).map(s => { const i = s.indexOf("="); return [s.slice(2, i), s.slice(i + 1)]; }));
if (!args.inputs || !args.output) throw new Error("--inputs --output required");
if (args.inputs.includes("holdout")) {
  const freeze = JSON.parse(await readFile("eval/light-dom/freeze.json", "utf8"));
  if (!freeze.lockedAt) throw new Error("Global freeze required");
}
const inputBytes = await readFile(args.inputs), inputs = JSON.parse(inputBytes);
const modelBytes = await readFile("eval/light-dom/structural-model.json"), model = JSON.parse(modelBytes);
const paths = ["/eval/light-dom/structural.mjs", "/eval/tiny-decision/v2/features.mjs"];
const sourceBytes = new Map(await Promise.all(paths.map(async path => [path, await readFile(path.slice(1))])));
const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/") return response.writeHead(200, { "Content-Type": "text/html" }).end("<!doctype html><title>DOM ranker timing</title>");
  if (!paths.includes(path)) return response.writeHead(404).end();
  response.writeHead(200, { "Content-Type": "text/javascript" }).end(sourceBytes.get(path));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: "chromium", headless: true });
  const page = await browser.newPage();
  const externalRequests = [];
  await page.route("**/*", route => {
    if (route.request().url().startsWith(origin + "/")) return route.continue();
    externalRequests.push(route.request().url()); return route.abort();
  });
  await page.goto(origin);
  const report = await page.evaluate(async ({ inputs, model }) => {
    const start = performance.now();
    const { predict } = await import("/eval/light-dom/structural.mjs");
    const moduleLoadMs = performance.now() - start;
    const rows = inputs.map(row => {
      const began = performance.now(), first = predict(model, row), firstMs = performance.now() - began;
      const trials = [];
      for (let trial = 0; trial < 30; trial++) {
        const t = performance.now();
        for (let i = 0; i < 10; i++) predict(model, row);
        trials.push((performance.now() - t) / 10);
      }
      trials.sort((a, b) => a - b);
      return { id: row.id, ...first, firstMs, warmMedianMs: trials[14], warmP95Ms: trials[28], reversedChosenId: predict(model, { ...row, options: [...row.options].reverse() }).chosenId, candidateCount: row.options.length - 1 };
    });
    return { userAgent: navigator.userAgent, moduleLoadMs, rows, jsHeap: performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize } : null };
  }, { inputs, model });
  const hash = b => createHash("sha256").update(b).digest("hex");
  Object.assign(report, { model: model.model, modelBytes: modelBytes.length, modelSha256: hash(modelBytes), inputSha256: hash(inputBytes), sourceHashes: Object.fromEntries([...sourceBytes].map(([path, bytes]) => [path.slice(1), hash(bytes)])), externalRequests, finishedAt: new Date().toISOString(), timingScope: "Full observed-evidence featurePack, feature construction, vectorization, linear scoring and selection; excludes live DOM collection, image fetch and network. 30 trials of ten full calls per field; first call separately. Browser JS heap is not complete process memory." });
  await mkdir(dirname(args.output), { recursive: true });
  await writeFile(args.output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ rows: report.rows.length, bytes: report.modelBytes, warmMedianMs: report.rows.map(r => r.warmMedianMs).sort((a, b) => a - b)[Math.floor(report.rows.length / 2)], externalRequests: externalRequests.length }));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
