import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { score, summarize } from "../eval/tiny-decision/metrics.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const index = arg.indexOf("=");
    return [arg.slice(2, index), arg.slice(index + 1)];
  }),
);
if (!args.jobs || !args.output)
  throw new Error("--jobs=tokenized.json --output=report.json required");
const jobs = JSON.parse(await readFile(args.jobs, "utf8"));
const ortDir = resolve(
  "eval/tiny-decision/slayer/node_modules/onnxruntime-web/dist",
);
const routes = {
  "/model.onnx": resolve(".tmp/slayer-onnx/model.onnx"),
  "/webgpu.mjs": resolve("eval/tiny-decision/slayer/webgpu.mjs"),
};
for (const name of await readdir(ortDir))
  if (/\.(wasm|mjs)$/.test(name))
    routes[`/ort/${name}`] = resolve(ortDir, name);
const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/") {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(
      '<!doctype html><title>Slayer WebGPU compatibility evaluation</title><script type="module" src="/webgpu.mjs"></script>',
    );
    return;
  }
  if (!routes[path]) {
    response.writeHead(404).end();
    return;
  }
  try {
    const size = (await stat(routes[path])).size;
    response.writeHead(200, {
      "Content-Type": path.endsWith(".wasm")
        ? "application/wasm"
        : path.endsWith(".mjs")
          ? "text/javascript"
          : "application/octet-stream",
      "Content-Length": size,
      "Cache-Control": "no-store",
    });
    createReadStream(routes[path]).pipe(response);
  } catch {
    response.writeHead(500).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const baseReport = {
  schemaVersion: 1,
  sourceSha256: jobs.sourceSha256,
  export: JSON.parse(await readFile(".tmp/slayer-onnx/export.json", "utf8")),
  startedAt: new Date().toISOString(),
};
await mkdir(dirname(resolve(args.output)), { recursive: true });
let currentReport = {};
const save = async (report) => {
  currentReport = { ...currentReport, ...report };
  return writeFile(
    args.output,
    JSON.stringify({ ...baseReport, ...currentReport }, null, 2) + "\n",
  );
};
try {
  browser = await chromium.launch({ channel: "chromium", headless: true });
  const page = await browser.newPage();
  await page.route("**/*", (route) =>
    route
      .request()
      .url()
      .startsWith(origin + "/")
      ? route.continue()
      : route.abort(),
  );
  page.on("console", (message) =>
    console.log(message.type(), message.text().slice(0, 350)),
  );
  page.on("pageerror", (error) => console.error(error.message));
  await page.exposeFunction("reportSlayerProgress", async (report) => {
    await save(report);
    console.log(JSON.stringify(report.rows.at(-1)));
  });
  await page.goto(origin);
  await page.waitForFunction(() => typeof globalThis.runSlayer === "function");
  const result = await page.evaluate(
    (data) => globalThis.runSlayer(data),
    jobs.jobs,
  );
  if (args.reference) {
    const reference = JSON.parse(await readFile(args.reference, "utf8"));
    if (reference.datasetSha256 !== jobs.sourceSha256)
      throw new Error(
        "CPU reference and browser jobs have different source checksums",
      );
    result.rows = result.rows.map((row) => {
      const expected = reference.rows.find(
        (other) =>
          other.id === row.id &&
          (other.template ?? null) === (row.template ?? null),
      );
      if (!expected)
        throw new Error(`No native reference for ${row.id}/${row.template}`);
      return score(
        {
          ...expected,
          options: (
            expected.optionIds ||
            jobs.jobs.find((job) => job.id === row.id).optionIds
          ).map((id) => ({ id })),
        },
        row,
      );
    });
    result.nativeComparison = result.rows.map((row) => {
      const native = reference.rows.find(
        (other) =>
          other.id === row.id &&
          (other.template ?? null) === (row.template ?? null),
      );
      return {
        id: row.id,
        template: row.template,
        bothErrors: Boolean(row.error && native.error),
        sameChoice: row.chosenId != null && row.chosenId === native.chosenId,
        maxLogScoreError:
          row.logScores && native.logScores
            ? Math.max(
                ...row.logScores.map((value, i) =>
                  Math.abs(value - native.logScores[i]),
                ),
              )
            : null,
      };
    });
    result.summary = summarize(result.rows);
    result.successfulLatency = summarize(
      result.rows.filter((row) => !row.error),
    );
  }
  await save({ ...result, finishedAt: new Date().toISOString() });
} catch (error) {
  await save({ error: String(error), finishedAt: new Date().toISOString() });
  throw error;
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
