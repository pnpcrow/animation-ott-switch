import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
const get = (name) =>
  process.argv
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.slice(name.length + 3);
const url = get("url"),
  query = get("query");
if (!url || !query)
  throw new Error(
    "--url=공식페이지 --query=작품제목 --output=artifacts/관측.json 을 지정하세요.",
  );
const output = resolve(get("output") || "artifacts/webllm-observation.json");
const bundle = await build({
  entryPoints: ["eval/webllm/collect.mjs"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "ottEvidenceCollector",
  target: "es2022",
});
const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(4000);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const observation = await page.evaluate(
    (query) =>
      globalThis.ottEvidenceCollector.collectEvidence(document, {
        pageUrl: location.href,
        query,
      }),
    query,
  );
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(observation, null, 2));
  console.log(
    JSON.stringify({
      output,
      pageUrl: observation.pageUrl,
      evidence: observation.input.evidence.length,
      candidates: observation.input.candidates.length,
    }),
  );
} finally {
  await browser.close();
}
