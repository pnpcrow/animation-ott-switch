import { build } from "esbuild";
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

// Development diagnostics. These hand-authored cases are not a blind model test.
const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, "../..");
const image = "https://fixture.invalid/hero.svg";
const title = "어느 마녀가 죽을 때까지";
const synopsis =
  "견습 마녀 메구는 자신의 운명을 바꾸기 위해 사람들의 기쁨의 눈물을 모으는 여행을 시작한다.";
const hero = `<section class="hero" aria-label="작품 대표 이미지"><img class="poster" src="${image}" width="720" height="405"></section>`;
const details = `<h1>${title}</h1><p class="synopsis">${synopsis}</p>${hero}`;
const background = Array.from(
  { length: 160 },
  (_, i) =>
    `<article class="content-card"><a href="/title/${i}"><h2 class="title">배경 작품 ${i}</h2><img src="https://fixture.invalid/background-${i}.svg"><p>추천 내용 ${i}</p></a></article>`,
).join("");
const scenes = [
  {
    id: "late-active-modal",
    html: `<main>${background}</main><div role="dialog" aria-modal="true">${details}<section class="episodes"><h1>1화: 다른 제목</h1><p class="synopsis">이번 회차만의 요약이므로 작품 설명으로 선택하면 안 된다.</p></section><section class="recommendations">${background}</section></div>`,
    gold: { title: [title], description: [synopsis], image: [image] },
    selected: { title, description: synopsis, image },
  },
  {
    id: "standalone-detail",
    html: `<nav><h1>탐색 메뉴</h1></nav><main><div class="subtitle"><h1>자막 설정</h1></div><article>${details}<p>일반 안내 문구는 의미 있는 작품 소개가 있다는 단서 없이 자동으로 선택하지 않는다.</p></article></main>`,
    gold: { title: [title], description: [synopsis], image: [image] },
    selected: { title, description: synopsis, image },
  },
  {
    id: "ambiguous-detail",
    html: `<main><article><h1>첫 번째 작품</h1><p class="synopsis">첫 번째 작품의 이야기이며 다른 작품과 섞어서 선택하지 않아야 하는 설명이다.</p></article><article><h1>두 번째 작품</h1><p class="synopsis">두 번째 작품의 이야기이며 다른 작품과 섞어서 선택하지 않아야 하는 설명이다.</p></article></main>`,
    gold: {
      title: ["첫 번째 작품", "두 번째 작품"],
      description: [],
      image: [],
    },
    selected: { title: null, description: null, image: null },
  },
  {
    id: "tooltip-and-body-decoys",
    html: `<main><span title="이것은 툴팁">도움말</span><div class="subtitle"><h1>회차 자막 제목</h1></div><article class="body">일반 본문이라는 이름만으로 이 영역을 작품 설명으로 확정할 수는 없다.</article><section>${details}</section></main>`,
    gold: { title: [title], description: [synopsis], image: [image] },
    selected: { title, description: synopsis, image },
  },
  {
    id: "tiny-provider-image",
    html: `<main><h1>${title}</h1><div aria-label="WATCHA"><img id="provider-icon" src="https://fixture.invalid/provider.svg" width="23" height="23"></div><p class="synopsis">${synopsis}</p>${hero}</main>`,
    gold: { title: [title], description: [synopsis], image: [image] },
    selected: { title, description: synopsis, image },
  },
  {
    id: "hidden-modal",
    html: `<main>${details}</main><div hidden><div role="dialog"><h1>숨겨진 작품</h1><p class="synopsis">숨겨진 모달에 남은 다른 작품의 설명을 가져오면 현재 작품과 불일치한다.</p></div></div>`,
    gold: { title: [title], description: [synopsis], image: [image] },
    selected: { title, description: synopsis, image },
  },
];

const bundle = await build({
  stdin: {
    contents:
      'export * from "./src/providers/dom-local.ts"; export * from "./src/providers/dom-links.ts";',
    resolveDir: repository,
  },
  bundle: true,
  format: "iife",
  globalName: "DomLocal",
  write: false,
  platform: "browser",
  target: "chrome120",
});
const source = await readFile(
  path.join(repository, "src/providers/dom-local.ts"),
);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.route("**/*", (route) =>
  route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="1440"><rect width="1440" height="1440" fill="#345"/></svg>',
  }),
);
const results = [];
try {
  for (const scene of scenes) {
    await page.setContent(
      `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>body{margin:0}img{object-fit:cover}</style></head><body>${scene.html}</body></html>`,
    );
    await page.waitForFunction(() =>
      [...document.images].every((image) => image.complete),
    );
    // Measure before inserting our diagnostic bundle; it is not page content.
    const htmlBytes = await page.evaluate(
      () => new TextEncoder().encode(document.documentElement.outerHTML).length,
    );
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const result = await page.evaluate(
      ({ id, gold, selected, htmlBytes }) => {
        const api = window.DomLocal;
        const fields = [];
        const bytes = (value) => new TextEncoder().encode(value).length;
        for (const field of ["title", "description", "image"]) {
          const collect = () =>
            api.collectLocalField(
              document,
              field,
              "https://fixture.invalid/title/current",
            );
          for (let i = 0; i < 10; i++) collect();
          const times = [];
          for (let i = 0; i < 50; i++) {
            const start = performance.now();
            collect();
            times.push(performance.now() - start);
          }
          times.sort((a, b) => a - b);
          const result = collect();
          const choice = api.selectLocalField(result);
          const payload = JSON.stringify(
            api.localDecisionInput(field, result.candidates),
          );
          fields.push({
            field,
            goldCount: gold[field].length,
            retrievedGold: gold[field].filter((value) =>
              result.candidates.some((candidate) => candidate.value === value),
            ).length,
            candidateCount: result.candidates.length,
            selected: choice?.value ?? null,
            expectedSelection: selected[field],
            visited: result.visited,
            truncated: result.truncated,
            inputBytes: bytes(payload),
            p50Ms: times[Math.floor(times.length * 0.5)],
            p95Ms: times[Math.floor(times.length * 0.95)],
            nativeXPathMatches: result.candidates.filter(
              (candidate) =>
                candidate.xpath &&
                document.evaluate(
                  candidate.xpath,
                  result.scope,
                  null,
                  XPathResult.FIRST_ORDERED_NODE_TYPE,
                  null,
                ).singleNodeValue === candidate.element,
            ).length,
            candidateValues: result.candidates.map(
              (candidate) => candidate.value,
            ),
          });
        }
        const images = api.collectLocalField(
          document,
          "image",
          "https://fixture.invalid/title/current",
        );
        const poster = images.candidates.find((candidate) =>
          candidate.value.endsWith("/hero.svg"),
        );
        const provider = document.getElementById("provider-icon");
        return {
          id,
          htmlBytes,
          fields,
          imageEvidence: poster
            ? {
                rendered: poster.context.self.rendered,
                intrinsic: poster.context.intrinsic,
                parentLabel: poster.context.parents[0]?.label,
              }
            : null,
          providerDimensions: provider
            ? {
                rendered: {
                  width: provider.getBoundingClientRect().width,
                  height: provider.getBoundingClientRect().height,
                },
                intrinsic: {
                  width: provider.naturalWidth,
                  height: provider.naturalHeight,
                },
                included: images.candidates.some(
                  (candidate) => candidate.element === provider,
                ),
              }
            : null,
        };
      },
      { id: scene.id, gold: scene.gold, selected: scene.selected, htmlBytes },
    );
    for (const field of result.fields) {
      assert.equal(
        field.selected,
        field.expectedSelection,
        `${scene.id}/${field.field}: fallback selection`,
      );
      assert.equal(
        field.retrievedGold,
        field.goldCount,
        `${scene.id}/${field.field}: candidate recall`,
      );
      assert.equal(
        field.nativeXPathMatches,
        field.candidateCount,
        `${scene.id}/${field.field}: native XPath`,
      );
      assert.equal(
        field.truncated,
        false,
        `${scene.id}/${field.field}: scan completion`,
      );
    }
    if (result.imageEvidence) {
      assert.deepEqual(result.imageEvidence.rendered, {
        width: 720,
        height: 405,
      });
      assert.deepEqual(result.imageEvidence.intrinsic, {
        width: 1440,
        height: 1440,
      });
      assert.equal(result.imageEvidence.parentLabel, "작품 대표 이미지");
    }
    if (result.providerDimensions) {
      assert.deepEqual(result.providerDimensions.rendered, {
        width: 23,
        height: 23,
      });
      assert.deepEqual(result.providerDimensions.intrinsic, {
        width: 1440,
        height: 1440,
      });
      assert.equal(result.providerDimensions.included, false);
    }
    results.push(result);
  }
  await page.setContent(
    `<main><h1>${title}</h1>${Array.from({ length: 400 }, (_, i) => `<div>일반 구조 ${i}</div>`).join("")}</main>`,
  );
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const progressive = await page.evaluate(() => {
    const api = window.DomLocal;
    const scanner = api.createDomFieldScanner(
      document,
      "title",
      "https://fixture.invalid/title/current",
      { sliceSize: 10 },
    );
    const first = scanner.next();
    const firstTitle = first.candidates[0];
    const nativeMatches =
      document.evaluate(
        firstTitle.xpath,
        scanner.scope,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null,
      ).singleNodeValue === firstTitle.element;
    scanner.close();
    const closed = scanner.next();
    const full = api.collectLocalField(
      document,
      "title",
      "https://fixture.invalid/title/current",
    );
    const old = firstTitle.element;
    const replacement = document.createElement("h1");
    replacement.textContent = "다른 작품";
    old.replaceWith(replacement);
    const resolved = api.resolveLocalXPath(scanner.scope, firstTitle.xpath);
    return {
      firstVisited: first.visited,
      firstCandidates: first.candidates.length,
      firstDone: first.done,
      fullVisited: full.visited,
      stoppedDone: closed.done,
      stoppedCandidates: closed.candidates.length,
      nativeMatches,
      locatorChangedIdentityAfterMutation: resolved !== old,
      locatorValueChangedAfterMutation:
        resolved?.textContent !== firstTitle.value,
    };
  });
  assert.equal(progressive.firstCandidates, 1);
  assert.equal(progressive.firstDone, false);
  assert.equal(progressive.stoppedDone, true);
  assert.equal(progressive.stoppedCandidates, 0);
  assert.equal(progressive.nativeMatches, true);
  assert.equal(progressive.locatorChangedIdentityAfterMutation, true);
  assert.equal(progressive.locatorValueChangedAfterMutation, true);
  assert.ok(progressive.firstVisited < progressive.fullVisited / 10);
  await page.setContent(
    `<main><article><a href="/title/matched">${title}</a></article><article><button onclick="location.assign('/title/literal')">작품 상세 보기</button></article><article><button onclick="router.go(workId)">동적 작품 상세 보기</button></article><a href="/logout">로그아웃</a><a href="javascript:window.executed=true">스크립트 실행</a><form method="post" action="/title/purchase"><button>구매</button></form><script>window.executed=false; window.router={go(){window.executed=true;}};</script></main>`,
  );
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const navigation = await page.evaluate(() => {
    const result = window.DomLocal.collectWorkLinkEvidence(
      document.querySelector("main"),
      "https://fixture.invalid/search",
    );
    const evidence = result.candidates.map(
      ({ element, ...candidate }) => candidate,
    );
    return {
      candidates: evidence,
      visited: result.visited,
      truncated: result.truncated,
      inputBytes: new TextEncoder().encode(JSON.stringify(evidence)).length,
      executed: window.executed,
    };
  });
  assert.deepEqual(
    navigation.candidates
      .filter((candidate) => candidate.status === "url")
      .map((candidate) => candidate.url),
    [
      "https://fixture.invalid/title/matched",
      "https://fixture.invalid/title/literal",
    ],
  );
  assert.equal(
    navigation.candidates.filter((candidate) => candidate.status === "unknown")
      .length,
    1,
  );
  assert.equal(navigation.executed, false);
  assert.equal(navigation.truncated, false);
  const report = {
    kind: "hand-authored development diagnostic; not blind validation or model accuracy",
    generatedAt: new Date().toISOString(),
    sourceSha256: createHash("sha256").update(source).digest("hex"),
    linkSourceSha256: createHash("sha256")
      .update(
        await readFile(path.join(repository, "src/providers/dom-links.ts")),
      )
      .digest("hex"),
    browserVersion: browser.version(),
    viewport: { width: 1280, height: 900 },
    timings: {
      warmupPerField: 10,
      measuredPerField: 50,
      note: "Headless isolated Chromium; full field scan including scope discovery; performance.now resolution limits submillisecond timings.",
    },
    results,
    progressive,
    navigation,
  };
  await writeFile(
    path.join(directory, "browser-results.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  const checks = results.flatMap((row) => row.fields);
  const markdown = [
    "# Local DOM browser development diagnostic",
    "",
    `Generated: ${report.generatedAt}; isolated headless Chromium ${report.browserVersion}; viewport 1280 × 900.`,
    "",
    `Hand-authored fixtures: ${results.length}; field selection checks: ${checks.length}; annotated candidate values recovered: ${checks.reduce((n, row) => n + row.retrievedGold, 0)}/${checks.reduce((n, row) => n + row.goldCount, 0)}. All expected selections/abstentions and native XPath roundtrips passed. These figures measure these fixtures only; they are not model accuracy or blind service/work validation.`,
    "",
    "| Fixture | Full fixture HTML bytes | Three local JSON inputs bytes | Largest per-field visited count | Per-field p50 range (ms) | Per-field p95 range (ms) |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...results.map(
      (row) =>
        `| ${row.id} | ${row.htmlBytes} | ${row.fields.reduce((n, field) => n + field.inputBytes, 0)} | ${Math.max(...row.fields.map((field) => field.visited))} | ${Math.min(...row.fields.map((field) => field.p50Ms)).toFixed(2)}–${Math.max(...row.fields.map((field) => field.p50Ms)).toFixed(2)} | ${Math.min(...row.fields.map((field) => field.p95Ms)).toFixed(2)}–${Math.max(...row.fields.map((field) => field.p95Ms)).toFixed(2)} |`,
    ),
    "",
    "The HTML column excludes the injected test bundle. It is a serialization-size reference, not the previous production extractor's input and not a browser RAM measurement. For small pages, structured context JSON can be larger than the source HTML. Each latency runs after 10 warmups, with 50 measured full field scans including scope discovery. Submillisecond readings are constrained by timer resolution; zero does not mean zero work.",
    "",
    `The progressive fixture yielded its first title after ${progressive.firstVisited} visited nodes versus ${progressive.fullVisited} for the full scan. Calling close() prevented further candidates. An early candidate is not proof of uniqueness: deterministic fallback still needs a complete, unambiguous scan.`,
    "",
    "Both the hero and provider icon loaded an actual 1440 × 1440 SVG in Chromium. The collector preserved the hero's 720 × 405 rendered size separately from its intrinsic size and its parent's accessible label. The 23 × 23 provider icon was excluded. A changed DOM caused the same positional XPath to resolve to a different element/value, confirming that a locator alone cannot safely authorize later use.",
    "",
    `Navigation evidence: two literal URLs plus one unknown dynamic action; ${navigation.inputBytes} serialized bytes. Logout, javascript: target and POST purchase form were excluded. No action executed. A collected URL remains unverified work evidence.`,
    "",
    "Limitations: synthetic development fixtures, no actual OTT CSS/runtime replay, no model inference, no unseen-service estimate, no process/heap RAM claim. The main benefit demonstrated here is bounded field-local evidence and retained disambiguating context. Actual candidate recall and classifier accuracy need a separately collected corpus before broader automatic adoption.",
    "",
    `DOM source SHA-256: \`${report.sourceSha256}\``,
    "",
    `Link source SHA-256: \`${report.linkSourceSha256}\``,
    "",
  ].join("\n");
  await writeFile(path.join(directory, "RESULTS.md"), markdown);
  console.log(
    JSON.stringify(
      {
        cases: results.length,
        fieldChecks: results.length * 3,
        retrievedGold: results
          .flatMap((row) => row.fields)
          .reduce((n, row) => n + row.retrievedGold, 0),
        goldCount: results
          .flatMap((row) => row.fields)
          .reduce((n, row) => n + row.goldCount, 0),
        totalLocalInputBytes: results
          .flatMap((row) => row.fields)
          .reduce((n, row) => n + row.inputBytes, 0),
        progressive,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
