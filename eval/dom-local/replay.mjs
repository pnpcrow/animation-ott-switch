import { build } from "esbuild";
import { chromium } from "playwright";
import { parseHTML } from "linkedom";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

// The old development examples have already informed implementation decisions.
// Replaying them is never a fresh blind test, model metric, or live layout test.
const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, "../..");
const annotationPath = path.join(
  repository,
  "eval/dom-scale/collection-train/annotations.json",
);
const inputPath = path.join(
  repository,
  "eval/dom-scale/collection-train/inputs.json",
);
const annotations = JSON.parse(await readFile(annotationPath, "utf8"));
const inputs = JSON.parse(await readFile(inputPath, "utf8"));
const cases = [
  {
    pageId: "scale-laftel-jujutsu-kaisen-search-opened-work",
    verifiedRoot: "#item-modal",
  },
  {
    pageId: "scale-prime-look-back-detail",
    verifiedRoot: 'main, [role="main"]',
  },
  {
    pageId: "scale-tving-frieren-detail",
    verifiedRoot: 'section:has([data-testid="content-detail-cta-button"])',
  },
];
const source = await readFile(
  path.join(repository, "src/providers/dom-local.ts"),
);
const bundle = await build({
  stdin: {
    contents: 'export * from "./src/providers/dom-local.ts";',
    resolveDir: repository,
  },
  bundle: true,
  format: "iife",
  globalName: "DomLocal",
  write: false,
  platform: "browser",
  target: "chrome120",
});
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.route("**/*", (route) => route.abort());
await page.setContent("<html><body>Inert DOM replay harness</body></html>");
await page.addScriptTag({ content: bundle.outputFiles[0].text });
const results = [];
try {
  for (const item of cases) {
    const annotation = annotations.find((row) => row.pageId === item.pageId);
    if (!annotation)
      throw new Error(`Missing frozen annotation for ${item.pageId}`);
    const original = await readFile(
      path.join(repository, ".tmp/dom-scale/train", item.pageId + ".html"),
      "utf8",
    );
    const { document } = parseHTML(original);
    document
      .querySelectorAll("script,iframe,object,embed,link,meta[http-equiv]")
      .forEach((element) => element.remove());
    for (const element of document.querySelectorAll("*")) {
      for (const name of element.getAttributeNames())
        if (/^on/i.test(name)) element.removeAttribute(name);
    }
    const gold = {};
    for (const field of ["title", "description", "image"]) {
      const input = inputs.find((row) => row.id === item.pageId + "-" + field);
      const ids = [annotation.fields[field]].flat();
      gold[field] = {
        ids,
        values: ids
          .filter((id) => id !== "__none__")
          .map(
            (id) =>
              input.options.find((option) => option.id === id)?.evidence?.value,
          )
          .filter(Boolean),
      };
    }
    const result = await page.evaluate(
      ({ html, url, verifiedRoot, gold }) => {
        const api = window.DomLocal;
        // Detached parsing keeps captured scripts inert and gives unknown geometry.
        const document = new DOMParser().parseFromString(html, "text/html");
        const root = document.querySelector(verifiedRoot);
        const normalize = (text) =>
          text.normalize("NFKC").replace(/\s+/g, " ").trim();
        const rows = [];
        for (const strategy of ["automatic-scope", "caller-verified-root"]) {
          if (strategy === "caller-verified-root" && !root) {
            rows.push({ strategy, missingRoot: true });
            continue;
          }
          for (const field of ["title", "description", "image"]) {
            const collect = () =>
              api.collectLocalField(
                strategy === "automatic-scope" ? document : root,
                field,
                url,
              );
            for (let i = 0; i < 5; i++) collect();
            const times = [];
            for (let i = 0; i < 20; i++) {
              const start = performance.now();
              collect();
              times.push(performance.now() - start);
            }
            times.sort((a, b) => a - b);
            const result = collect();
            const match = (candidate) =>
              gold[field].values.some((value) =>
                field === "description"
                  ? normalize(candidate.value).startsWith(normalize(value))
                  : normalize(candidate.value) === normalize(value),
              );
            const chosen = api.selectLocalField(result);
            rows.push({
              strategy,
              field,
              goldOptionIds: gold[field].ids,
              comparison:
                field === "description"
                  ? "old gold description prefix (not exact full-value equality)"
                  : "exact normalized value against any accepted old option",
              goldPresent: gold[field].values.length > 0,
              candidateRecovered: result.candidates.some(match),
              candidateCount: result.candidates.length,
              fallback: chosen
                ? match(chosen)
                  ? "matches-old-gold"
                  : "different-value"
                : "abstained",
              visited: result.visited,
              truncated: result.truncated,
              localInputBytes: new TextEncoder().encode(
                JSON.stringify(
                  api.localDecisionInput(field, result.candidates),
                ),
              ).length,
              p50Ms: times[10],
              p95Ms: times[18],
              scopeTag: result.scope.tagName.toLowerCase(),
            });
          }
        }
        return { verifiedRootFound: !!root, rows };
      },
      {
        html: document.toString(),
        url: annotation.actualUrl,
        verifiedRoot: item.verifiedRoot,
        gold,
      },
    );
    results.push({
      pageId: item.pageId,
      provider: annotation.provider,
      pageKind: annotation.pageKind,
      originalHtmlBytes: Buffer.byteLength(original),
      originalSha256: createHash("sha256").update(original).digest("hex"),
      verifiedRootSelector: item.verifiedRoot,
      ...result,
    });
  }
  const report = {
    kind: "consumed public development HTML diagnostic; not fresh blind evaluation or model accuracy",
    generatedAt: new Date().toISOString(),
    browserVersion: browser.version(),
    sourceSha256: createHash("sha256").update(source).digest("hex"),
    annotationSource: path
      .relative(repository, annotationPath)
      .replaceAll("\\", "/"),
    inputSource: path.relative(repository, inputPath).replaceAll("\\", "/"),
    replay:
      "Detached DOMParser documents; scripts/events/resources disabled; geometry unavailable and external stylesheets omitted. Existing inline hidden styles retained. Five warmups, twenty measurements per field.",
    results,
  };
  await writeFile(
    path.join(directory, "replay-results.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  const markdown = [
    "# Consumed public DOM replay diagnostic",
    "",
    `Generated: ${report.generatedAt}; Chromium ${report.browserVersion}.`,
    "",
    "Three public development snapshots from the previous experiment were reused. Their labels and source files were read without modification. They are consumed development evidence, not unseen service/work validation. No learned model was evaluated or retrained.",
    "",
    "The snapshots were parsed into detached browser documents after removing scripts, event attributes, frames and external stylesheet links. Network access was blocked. Actual layout and external CSS are unavailable, so this diagnoses structure and text only. Browser size handling is tested separately in browser.mjs. Each field scan ran after five warmups with twenty measured repetitions.",
    "",
    "| Page | Scope | Title recovered | Description prefix recovered | Image recovered | Fallback title / description / image | Max visited | Total local bytes | Per-field p50 range (ms) |",
    "| --- | --- | ---: | ---: | ---: | --- | ---: | ---: | ---: |",
    ...results.flatMap((result) =>
      ["automatic-scope", "caller-verified-root"].map((strategy) => {
        const rows = result.rows.filter((row) => row.strategy === strategy);
        if (rows[0]?.missingRoot)
          return `| ${result.pageId} | ${strategy} | — | — | — | root absent | — | — | — |`;
        return `| ${result.pageId} | ${strategy} | ${rows.find((row) => row.field === "title")?.candidateRecovered ? "yes" : "no"} | ${rows.find((row) => row.field === "description")?.candidateRecovered ? "yes" : "no"} | ${rows.find((row) => row.field === "image")?.candidateRecovered ? "yes" : "no"} | ${rows.map((row) => row.fallback).join(" / ")} | ${Math.max(...rows.map((row) => row.visited))} | ${rows.reduce((n, row) => n + row.localInputBytes, 0)} | ${Math.min(...rows.map((row) => row.p50Ms)).toFixed(2)}–${Math.max(...rows.map((row) => row.p50Ms)).toFixed(2)} |`;
      }),
    ),
    "",
    "Recovered means at least one candidate matched an accepted old annotation. The old descriptions are bounded prefixes; prefix agreement is reported explicitly and is not an exact full-description metric. Multiple accepted artwork options are allowed. Candidate recovery does not mean a trained classifier selected it correctly. Abstention is expected when the scan is incomplete or several strong values compete.",
    "",
    "Observed limitations: the Prime Video accepted image URLs occur in metadata/picture alternatives rather than matching img.src/video.poster candidates, so this visible-node collector misses that field. TVING includes competing work/episode headings and artwork/description candidates; the relevant candidates are present but the deterministic fallback abstains. Existing metadata and provider adapters remain necessary for these cases. The Laftel expandable synopsis and title-image alt cases informed fixes during this development replay, which is another reason these results must not be called fresh validation.",
    "",
    "The caller-verified-root pass uses existing provider-adapter scope knowledge. It does not demonstrate provider-independent scope discovery. Results are diagnostic failures/successes, not a release accuracy target; retained metadata/provider extraction remains authoritative in production.",
    "",
    `Source SHA-256: \`${report.sourceSha256}\``,
    "",
  ].join("\n");
  await writeFile(path.join(directory, "REPLAY.md"), markdown);
  console.log(markdown);
} finally {
  await browser.close();
}
