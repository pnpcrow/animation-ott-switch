import { chromium } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { collectDomSnapshot } from "./collect.mjs";
const cases = JSON.parse(await readFile("qa/cross-check/cases.json", "utf8"));
const pages = cases.map((c) => ({
  id: c.id,
  work: c.id,
  url: c.source.url,
  scenarios: ["public-detail", "competing-metadata"],
}));
pages.push(
  {
    id: "frieren-aniplus",
    work: "frieren",
    url: "https://www.aniplustv.com/items/3011",
    scenarios: [
      "background-search-layer",
      "japanese-alias",
      "duplicate-metadata",
    ],
  },
  {
    id: "witch-tving",
    work: "witch",
    url: "https://www.tving.com/contents/P001791654",
    scenarios: [
      "episode-seo-title",
      "image-title-logo",
      "recommendation-cards",
    ],
  },
  {
    id: "frieren-tving",
    work: "frieren",
    url: "https://www.tving.com/contents/P001747384",
    scenarios: ["episode-seo-title", "dub-subtitle-labels"],
  },
  {
    id: "witch-wavve",
    work: "witch",
    url: "https://www.wavve.com/player/vod?programid=CF02_CF0000000119&landing=season",
    scenarios: [
      "image-title-logo",
      "full-vs-truncated-synopsis",
      "duplicate-metadata",
    ],
  },
  {
    id: "frieren-wavve-search",
    work: "frieren",
    url: "https://www.wavve.com/search?searchWord=장송의%20프리렌",
    scenarios: ["search-not-detail", "version-card-duplicates"],
  },
  {
    id: "dungeon-watcha-search",
    work: "dungeon",
    url: "https://watcha.com/search?query=던전밥",
    scenarios: ["incomplete-search-shell"],
  },
  {
    id: "dungeon-coupang-search",
    work: "dungeon",
    url: "https://www.coupangplay.com/search?q=던전밥",
    scenarios: ["unsupported-browser-or-search"],
  },
  {
    id: "witch-crunchyroll",
    work: "witch",
    url: "https://www.crunchyroll.com/search?q=어느%20마녀가%20죽을%20때까지",
    scenarios: ["generic-service-marketing"],
  },
);
const snapshots = [];
await mkdir(".tmp/tiny-dom-captures", { recursive: true });
await mkdir("eval/tiny-decision/data", { recursive: true });
const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  for (const entry of pages) {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      locale: "ko-KR",
    });
    let error;
    try {
      await page.goto(entry.url, {
        waitUntil: "domcontentloaded",
        timeout: 25000,
      });
      await page.waitForTimeout(3500);
    } catch (e) {
      error = e.message;
    }
    const html = await page.content();
    const snapshot = await page.evaluate(
      ({ fn }) => (0, eval)(`(${fn})`)(document, location.href),
      { fn: collectDomSnapshot.toString() },
    );
    snapshots.push({
      ...entry,
      capturedAt: new Date().toISOString(),
      htmlSha256: createHash("sha256").update(html).digest("hex"),
      ...snapshot,
      error,
    });
    await writeFile(`.tmp/tiny-dom-captures/${entry.id}.html`, html);
    await writeFile(
      "eval/tiny-decision/data/observations.json",
      JSON.stringify(snapshots, null, 2) + "\n",
    );
    console.log(
      JSON.stringify({
        id: entry.id,
        title: snapshot.documentTitle,
        counts: Object.fromEntries(
          Object.entries(snapshot.fields).map(([k, v]) => [k, v.length]),
        ),
        error,
      }),
    );
    await page.close();
  }
} finally {
  await browser.close();
}
