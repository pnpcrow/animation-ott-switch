import { chromium } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { cpus, platform, release, arch } from "node:os";
import {
  score,
  summarize,
  selectTemplate,
} from "../eval/tiny-decision/metrics.mjs";
import {
  templates,
  requestFor,
  readChoice,
  suppressedChoice,
} from "../eval/tiny-decision/needle3/templates.mjs";
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const i = a.indexOf("=");
    return i < 0
      ? [a.replace(/^--/, ""), true]
      : [a.slice(2, i), a.slice(i + 1)];
  }),
);
const assetDir = resolve(".tmp/needle3-runtime410"),
  sourceDir = resolve("eval/tiny-decision/needle3");
const sources = {
  "cactus.js": {
    url: "https://huggingface.co/Cactus-Compute/cactus/resolve/4e822c9036be2eb0e47ef556df32a818bb1572ef/releases/4.1.0/wasm/cactus.js",
    sha256: "707341e44776ab0eb8dfc8f6a579ed5ac41e2ffc6419a18012f61619a6dfc70c",
  },
  "cactus.wasm": {
    url: "https://huggingface.co/Cactus-Compute/cactus/resolve/4e822c9036be2eb0e47ef556df32a818bb1572ef/releases/4.1.0/wasm/cactus.wasm",
    sha256: "6fb6cb41145cd51fd8af97644cd684fbdd434d4d3ce261881df58cbaef5b67f7",
  },
  "needle3.cact": {
    url: "https://huggingface.co/Cactus-Compute/needle3/resolve/c95d25b4efa1e9601e785d92438e4ade0dbddbf8/needle3.cact",
    sha256: "c9d915eca282ed42d1a09b143b592adb4cc6744ffe2d294adf5cfc5548170c38",
  },
};
await mkdir(assetDir, { recursive: true });
for (const [name, spec] of Object.entries(sources)) {
  let bytes;
  try {
    bytes = await readFile(resolve(assetDir, name));
  } catch {
    if (!args["download-model"])
      throw new Error(
        "Use --download-model to explicitly download pinned official Needle3 assets",
      );
    const response = await fetch(spec.url);
    if (!response.ok) throw new Error(`Download failed ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== spec.sha256)
      throw new Error(`Checksum mismatch: ${name}`);
    await writeFile(resolve(assetDir, name), bytes);
  }
  if (createHash("sha256").update(bytes).digest("hex") !== spec.sha256)
    throw new Error(`Checksum mismatch: ${name}`);
}
const allowed = {
  "/": resolve(sourceDir, "index.html"),
  "/runtime.mjs": resolve(sourceDir, "runtime.mjs"),
  ...Object.fromEntries(
    Object.keys(sources).map((name) => [
      `/assets/${name}`,
      resolve(assetDir, name),
    ]),
  ),
};
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    if (!allowed[path]) {
      res.writeHead(404).end();
      return;
    }
    const body = await readFile(allowed[path]);
    res.writeHead(200, {
      "Content-Type": path.endsWith(".wasm")
        ? "application/wasm"
        : path.endsWith(".js") || path.endsWith(".mjs")
          ? "text/javascript"
          : path === "/"
            ? "text/html"
            : "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(500).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "chromium", headless: true });
const page = await browser.newPage();
const requests = [];
page.on("request", (r) => requests.push(r.url()));
const report = {
  schemaVersion: 1,
  model: "Cactus-Compute/needle3",
  engine: "Cactus 4.1.0 WASM CPU",
  modelRevision: "c95d25b4efa1e9601e785d92438e4ade0dbddbf8",
  runtimeRevision: "4e822c9036be2eb0e47ef556df32a818bb1572ef",
  assets: sources,
  startedAt: new Date().toISOString(),
  environment: {
    browser: browser.version(),
    os: `${platform()} ${release()} ${arch()}`,
    cpu: cpus()[0]?.model,
    logicalProcessors: cpus().length,
    maxNewTokens: 96,
    resetBeforeEveryCase: true,
  },
  runs: [],
};
report.templateSha256 = createHash("sha256")
  .update(await readFile(resolve(sourceDir, "templates.mjs")))
  .digest("hex");
const output = resolve(args.output || "artifacts/needle3-dom-evaluation.json");
await mkdir(dirname(output), { recursive: true });
try {
  await page.goto(origin);
  await page.waitForFunction(() => globalThis.needle3);
  report.load = await page.evaluate(() => globalThis.needle3.load());
  console.log(JSON.stringify(report.load));
  if (!args.dataset) {
    const smoke = {
      document:
        '<main><h1 id="main-title">Frieren</h1><p>Work synopsis.</p></main><nav><h1 id="brand">OTT Site</h1></nav>',
      question: "Which element is the visible main work title?",
      options: [
        { id: "brand", text: "nav > h1 text=OTT Site" },
        { id: "main-title", text: "main > h1 text=Frieren" },
        { id: "none", text: "No supported choice" },
      ],
    };
    const request = args["positive-control"]
      ? {
          tools: [
            {
              name: "get_weather",
              description: "Get the current weather for a city.",
              parameters: {
                type: "object",
                properties: {
                  city: { type: "string", description: "City name" },
                },
                required: ["city"],
              },
            },
          ],
          input: "What's the weather in Lagos?",
        }
      : requestFor(smoke, "enum-direct");
    report.smokeKind = args["positive-control"]
      ? "official-weather-control"
      : "small-dom";
    const response = await page.evaluate(
      (r) => globalThis.needle3.complete(r),
      request,
    );
    console.log(JSON.stringify(response));
    report.smoke = response;
  } else {
    const data = JSON.parse(await readFile(resolve(args.dataset), "utf8"));
    const cases = Array.isArray(data) ? data : data.cases;
    report.datasetSha256 = createHash("sha256")
      .update(JSON.stringify(data))
      .digest("hex");
    const templateNames = args.template ? [args.template] : templates;
    let calibrationIds;
    if (args["balanced-calibration"]) {
      if (String(args["balanced-calibration"]) !== "6")
        throw new Error("Only predeclared balanced-calibration=6 is supported");
      const calibration = cases.filter((c) => c.split === "calibration");
      const selected = [];
      for (const field of ["title", "image", "description"])
        for (const none of [false, true]) {
          const row = calibration.find(
            (c) => c.field === field && (c.expectedId === "__none__") === none,
          );
          if (!row)
            throw new Error(`Missing calibration stratum: ${field}/${none}`);
          selected.push(row.id);
        }
      calibrationIds = new Set(selected);
      report.calibrationSampling = {
        policy:
          "Before comparing templates, take the first frozen-order positive and first explicit abstention case for each of title/image/description. Selection uses field and ground-truth class only, never predictions. Full holdout retained.",
        reason:
          "Initial sequential browser WASM timing pilot exceeded the evaluation time budget; full 30-case calibration replaced with predeclared six-case strata.",
        available: calibration.length,
        selectedIds: selected,
        excludedIds: calibration
          .filter((c) => !calibrationIds.has(c.id))
          .map((c) => c.id),
        lockedAt: new Date().toISOString(),
      };
      await writeFile(output, JSON.stringify(report, null, 2) + "\n");
    }
    async function evaluate(template, split) {
      const rows = [];
      for (const item of cases.filter(
        (c) =>
          c.split === split &&
          (split !== "calibration" ||
            !calibrationIds ||
            calibrationIds.has(c.id)),
      )) {
        const safe = {
          document: item.document,
          question: item.question,
          options: item.options,
        };
        let row = { id: item.id, split: item.split };
        try {
          const response = await page.evaluate(
            (r) => globalThis.needle3.complete(r),
            requestFor(safe, template),
          );
          row = {
            ...row,
            ...response,
            ...readChoice(response.result, item.options, template),
          };
          row.suppressedId = suppressedChoice(
            response.result,
            item.options,
            template,
          );
          row.rawProposalCorrect = (
            item.acceptedIds || [item.expectedId]
          ).includes(row.chosenId || row.suppressedId);
        } catch (e) {
          row.error = e.message;
          row.correct = false;
        }
        row = score(item, row);
        rows.push(row);
        report.inProgress = { template, split, rows };
        await writeFile(output, JSON.stringify(report, null, 2) + "\n");
        console.log(
          JSON.stringify({
            template,
            id: item.id,
            chosenId: row.chosenId,
            correct: row.correct,
            elapsedMs: row.elapsedMs,
            error: row.error,
          }),
        );
      }
      const run = {
        template,
        split,
        rows,
        summary: {
          ...summarize(rows),
          rawProposalCorrect: rows.filter((r) => r.rawProposalCorrect).length,
          meanMs:
            rows.reduce((n, r) => n + (r.elapsedMs || 0), 0) / rows.length,
        },
      };
      report.runs.push(run);
      delete report.inProgress;
      await writeFile(output, JSON.stringify(report, null, 2) + "\n");
      console.log(JSON.stringify({ template, split, summary: run.summary }));
      return run;
    }
    for (const template of templateNames)
      await evaluate(template, args.split || "calibration");
    if (args["calibrate-holdout"]) {
      if (args.split && args.split !== "calibration")
        throw new Error("Selection must use calibration only");
      const selected = selectTemplate(report.runs);
      report.selection = {
        ...selected,
        lockedAt: new Date().toISOString(),
        note: "Native suppressed calls are diagnostic refusals, never counted as correct option selections.",
      };
      await writeFile(output, JSON.stringify(report, null, 2) + "\n");
      await evaluate(selected.template, "holdout");
    }
  }
  report.externalRequests = requests.filter((url) => !url.startsWith(origin));
  report.finishedAt = new Date().toISOString();
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
