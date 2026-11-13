import { chromium } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { cpus, platform, release, arch } from "node:os";
import {
  templates,
  requestFor,
} from "../eval/tiny-decision/v2/needle/templates.mjs";
import { guardedChoice } from "../eval/tiny-decision/v2/needle/choice-guard.mjs";
import { sampleDevelopment } from "../eval/tiny-decision/v2/sampling.mjs";
import { featurePack } from "../eval/tiny-decision/v2/features.mjs";
import {
  score,
  summarize,
  selectTemplate,
} from "../eval/tiny-decision/metrics.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const i = arg.indexOf("=");
    return i < 0
      ? [arg.replace(/^--/, ""), true]
      : [arg.slice(2, i), arg.slice(i + 1)];
  }),
);
if (!args.development && !args.selection)
  throw new Error(
    "--development=dataset.json or --selection=completed-development-report.json required",
  );
if (args.selection && !args.holdout)
  throw new Error("--selection requires --holdout");
const sha = (value) =>
  createHash("sha256")
    .update(
      typeof value === "string" || Buffer.isBuffer(value)
        ? value
        : JSON.stringify(value),
    )
    .digest("hex");
const templateSha256 = sha(
  await readFile("eval/tiny-decision/v2/needle/templates.mjs"),
);
const featureSourceSha256 = sha(
  await readFile("eval/tiny-decision/v2/features.mjs"),
);
const report = {
  schemaVersion: 2,
  model: "Cactus-Compute/needle3",
  engine: "Cactus 4.1.0 WASM CPU",
  modelRevision: "c95d25b4efa1e9601e785d92438e4ade0dbddbf8",
  runtimeRevision: "4e822c9036be2eb0e47ef556df32a818bb1572ef",
  templateSha256,
  featureSourceSha256,
  choiceGuardSha256: sha(
    await readFile("eval/tiny-decision/v2/needle/choice-guard.mjs"),
  ),
  runnerSha256: sha(await readFile("scripts/needle3-v2-eval.mjs")),
  parserBoundary:
    "Exact schema tool-name allowlist applied outside the frozen template compiler. Original development outputs audited: no unknown names; payloads, confidence gate and selection unchanged.",
  startedAt: new Date().toISOString(),
  runs: [],
  environment: {
    os: `${platform()} ${release()} ${arch()}`,
    cpu: cpus()[0]?.model,
    logicalProcessors: cpus().length,
    maxNewTokens: 96,
    resetBeforeEveryCase: true,
  },
  protocol:
    "Prior v1 corpus is development only. Fixed balanced12 old cases select one template before reading the new validation dataset. No model or runtime changes; no actions executed.",
  inputLimits: {
    desiredChars: 1800,
    hardChars: 2200,
    tokenCountObservable: false,
    internalTruncationObservable: false,
  },
};
const output = resolve(args.output || "artifacts/needle3-v2.json");
await mkdir(dirname(output), { recursive: true });
const save = () => writeFile(output, JSON.stringify(report, null, 2) + "\n");
async function readCases(path, labelPath) {
  const inputs = JSON.parse(await readFile(path, "utf8"));
  let rows = Array.isArray(inputs) ? inputs : inputs.cases;
  if (rows.some((row) => !row.expectedId)) {
    const sidecar =
      labelPath ||
      (path.endsWith("-inputs.json")
        ? path.replace(/-inputs\.json$/, "-labels.json")
        : null);
    if (!sidecar) throw new Error("Separate labels path required");
    const labels = JSON.parse(await readFile(sidecar, "utf8"));
    const byId = new Map(
      (Array.isArray(labels) ? labels : labels.cases).map((row) => [
        row.id,
        row,
      ]),
    );
    rows = rows.map((row) => {
      const label = byId.get(row.id);
      if (!label?.expectedId)
        throw new Error(`Missing scoring label ${row.id}`);
      return {
        ...row,
        expectedId: label.expectedId,
        acceptedIds: label.acceptedIds,
        provenance: label.provenance,
        quality: label.quality,
      };
    });
    return { rows, source: { inputs, labels } };
  }
  return { rows, source: inputs };
}
function prepareRequest(item, template) {
  const attempts = [];
  for (const textLimit of [96, 72, 48, 32]) {
    try {
      const request = requestFor(featurePack(item, { textLimit }), template);
      request.measured.textTier = textLimit;
      request.measured.previousTierFailures = attempts;
      return request;
    } catch (error) {
      if (!error.measured) throw error;
      attempts.push({ textLimit, chars: error.measured.chars });
      if (textLimit === 32) {
        error.measured.textTier = 32;
        error.measured.previousTierFailures = attempts;
        throw error;
      }
    }
  }
}
let development;
if (args.development) {
  const { rows, source } = await readCases(
    args.development,
    args["development-labels"],
  );
  report.developmentSha256 = sha(source);
  report.developmentSampling = {
    ...sampleDevelopment(rows),
    lockedAt: new Date().toISOString(),
  };
  const byId = new Map(rows.map((row) => [row.id, row]));
  development = report.developmentSampling.selectedIds.map((id) =>
    byId.get(id),
  );
} else {
  const prior = JSON.parse(await readFile(args.selection, "utf8"));
  if (!prior.finishedAt || !prior.selection || prior.error)
    throw new Error(
      "Completed development report with frozen selection required",
    );
  if (
    prior.templateSha256 !== templateSha256 ||
    prior.featureSourceSha256 !== featureSourceSha256
  )
    throw new Error("Frozen compiler/template differs from development run");
  report.selection = { ...prior.selection, sourceSha256: sha(prior) };
}
if (args["dry-run"]) {
  report.planned = development.flatMap((row) =>
    templates.map((template) => {
      try {
        const request = prepareRequest(row, template);
        return { id: row.id, template, ...request.measured };
      } catch (error) {
        return {
          id: row.id,
          template,
          error: error.message,
          measured: error.measured,
        };
      }
    }),
  );
  report.finishedAt = new Date().toISOString();
  await save();
  console.log(JSON.stringify(report.planned));
  process.exit(0);
}
const assetDir = resolve(".tmp/needle3-runtime410");
const assets = {
  "cactus.js":
    "707341e44776ab0eb8dfc8f6a579ed5ac41e2ffc6419a18012f61619a6dfc70c",
  "cactus.wasm":
    "6fb6cb41145cd51fd8af97644cd684fbdd434d4d3ce261881df58cbaef5b67f7",
  "needle3.cact":
    "c9d915eca282ed42d1a09b143b592adb4cc6744ffe2d294adf5cfc5548170c38",
};
for (const [name, expected] of Object.entries(assets))
  if (sha(await readFile(resolve(assetDir, name))) !== expected)
    throw new Error(`Pinned Needle asset checksum mismatch: ${name}`);
report.assetHashes = assets;
const paths = {
  "/": resolve("eval/tiny-decision/needle3/index.html"),
  "/runtime.mjs": resolve("eval/tiny-decision/needle3/runtime.mjs"),
  ...Object.fromEntries(
    Object.keys(assets).map((name) => [
      `/assets/${name}`,
      resolve(assetDir, name),
    ]),
  ),
};
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    if (!paths[path]) return res.writeHead(404).end();
    const body = await readFile(paths[path]);
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
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "chromium", headless: true });
const page = await browser.newPage();
const external = [];
await page.route("**/*", (route) => {
  if (new URL(route.request().url()).origin === origin) return route.continue();
  external.push(route.request().url());
  return route.abort();
});
report.environment.browser = browser.version();
async function evaluate(rows, template, stage) {
  const results = [];
  for (const item of rows) {
    let result = {
      id: item.id,
      template,
      stage,
      optionIds: item.options.map((o) => o.id),
    };
    try {
      const request = prepareRequest(item, template);
      const payload = {
        tools: request.tools,
        input: request.input,
        maxTokens: 96,
      };
      const response = await page.evaluate(
        (request) => globalThis.needle3.complete(request),
        payload,
      );
      result = {
        ...result,
        ...response,
        ...guardedChoice(response.result, request),
        request: payload,
        inputSize: request.measured,
        payloadSha256: sha(payload),
      };
      result.suppressedId = guardedChoice(response.result, request, {
        suppressed: true,
      }).chosenId;
    } catch (error) {
      result.error = error.message;
      result.inputSize = error.measured;
    }
    result = score({ ...item, split: stage }, result);
    result.rawProposalCorrect = (
      item.acceptedIds || [item.expectedId]
    ).includes(result.chosenId || result.suppressedId);
    results.push(result);
    report.inProgress = { template, stage, rows: results };
    await save();
    console.log(
      JSON.stringify({
        stage,
        template,
        id: item.id,
        chosenId: result.chosenId,
        correct: result.correct,
        ms: result.elapsedMs,
        chars: result.inputSize?.chars,
        error: result.error,
      }),
    );
  }
  const run = {
    template,
    split: stage,
    rows: results,
    summary: {
      ...summarize(results),
      rawProposalCorrect: results.filter((r) => r.rawProposalCorrect).length,
    },
  };
  report.runs.push(run);
  delete report.inProgress;
  await save();
  return run;
}
try {
  await page.goto(origin);
  await page.waitForFunction(() => globalThis.needle3);
  report.load = await page.evaluate(() => globalThis.needle3.load());
  if (development) {
    for (const template of templates)
      await evaluate(development, template, "development");
    const choice = selectTemplate(
      report.runs.map((run) => ({ ...run, split: "calibration" })),
    );
    report.selection = {
      template: choice.template,
      policy: choice.policy,
      development: choice.calibration,
      lockedAt: new Date().toISOString(),
      developmentIds: report.developmentSampling.selectedIds,
      templateSha256,
      featureSourceSha256,
      automaticNavigation: false,
    };
    await save();
  }
  if (args.holdout) {
    // Fresh validation is not read until a development-only choice has been frozen.
    const { rows, source } = await readCases(
      args.holdout,
      args["holdout-labels"],
    );
    report.holdoutSha256 = sha(source);
    report.holdoutReadAt = new Date().toISOString();
    await evaluate(rows, report.selection.template, "holdout");
  }
  report.externalRequests = external;
  report.finishedAt = new Date().toISOString();
  await save();
} catch (error) {
  report.error = error.message;
  await save();
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
