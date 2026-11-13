import { chromium } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { templates as availableTemplates } from "../eval/webllm/templates.mjs";
import { selectCalibration } from "../eval/webllm/core.mjs";
const allowModel = process.argv.includes("--download-model");
const evaluateAll = process.argv.includes("--evaluate");
const modelArg = process.argv
  .find((arg) => arg.startsWith("--model="))
  ?.slice(8);
const datasetArg = process.argv
  .find((arg) => arg.startsWith("--dataset="))
  ?.slice(10);
const reportPath = resolve(
  process.argv.find((arg) => arg.startsWith("--output="))?.slice(9) ||
    "artifacts/webllm-evaluation.json",
);
await mkdir(resolve("artifacts"), { recursive: true });
const context = await chromium.launchPersistentContext(
  resolve(".tmp/webllm-eval-profile"),
  {
    channel: "chromium",
    headless: true,
    args: process.argv.includes("--unsafe-webgpu")
      ? ["--enable-unsafe-webgpu"]
      : [],
    viewport: { width: 1440, height: 1100 },
  },
);
const page = await context.newPage();
const requests = [];
page.on("request", (request) => requests.push(request.url()));
page.on("console", (entry) => {
  if (entry.type() === "error") console.error(entry.text());
});
page.on("pageerror", (error) => console.error(error.message));
try {
  await page.goto(process.env.OTT_EVAL_URL || "http://127.0.0.1:4174");
  await page.waitForFunction(
    () =>
      globalThis.ottEvaluation &&
      !document.getElementById("gpu").textContent.includes("확인 중"),
  );
  const before = {
    gpu: await page.locator("#gpu").textContent(),
    externalRequests: requests.filter(
      (url) => !url.startsWith("http://127.0.0.1:"),
    ),
  };
  if (before.externalRequests.length)
    throw new Error("Initial page loaded external assets before model consent");
  console.log(JSON.stringify(before));
  await page.screenshot({
    path: "artifacts/webllm-evaluation.png",
    fullPage: true,
  });
  if (datasetArg)
    await page.evaluate(
      (raw) => globalThis.ottEvaluation.importDataset(raw),
      JSON.parse(await readFile(resolve(datasetArg), "utf8")),
    );
  if (allowModel) {
    if (modelArg) await page.selectOption("#model", modelArg);
    await page.check("#consent");
    const loading = page.evaluate(() => globalThis.ottEvaluation.load());
    let done = false;
    loading
      .finally(() => {
        done = true;
      })
      .catch(() => {});
    const deadline = Date.now() + 15 * 60_000;
    while (!done && Date.now() < deadline) {
      console.log(await page.locator("#runtime-status").textContent());
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    if (!done) throw new Error("Model loading exceeded 15 minutes");
    await loading;
    console.log(await page.locator("#runtime-status").textContent());
    if (evaluateAll) {
      const reports = [];
      const templates = availableTemplates.map((template) => template.id);
      const run = async (template, split) => {
        await page.selectOption("#template", template);
        await page.selectOption("#split", split);
        console.log(`Evaluating ${template}/${split}`);
        const result = await page.evaluate(() =>
          globalThis.ottEvaluation.evaluate(),
        );
        reports.push(result);
        await writeFile(
          reportPath,
          JSON.stringify({ schemaVersion: 1, reports }, null, 2),
        );
        console.log(
          JSON.stringify({ template, split, summary: result.summary }),
        );
      };
      for (const template of templates) await run(template, "calibration");
      const selected = selectCalibration(reports);
      console.log(
        `Calibration-selected template: ${selected.template}; holding out the remaining works until now`,
      );
      await run(selected.template, "holdout");
      await writeFile(
        reportPath,
        JSON.stringify(
          {
            schemaVersion: 1,
            selectionPolicy:
              "eligible first (all outputs valid, zero unsafe matches/errors, >=75% exact); then fewest unsafe matches, highest exact, highest valid, fewest errors; ties prefer newer template. No eligible template means diagnostic holdout only and existing-rule fallback.",
            selectedTemplate: selected.template,
            selection: selected,
            reports,
          },
          null,
          2,
        ),
      );
    }
    await page.screenshot({
      path: "artifacts/webllm-evaluation-result.png",
      fullPage: true,
    });
    await page.evaluate(() => globalThis.ottEvaluation.unload());
  }
} finally {
  await context.close();
}
