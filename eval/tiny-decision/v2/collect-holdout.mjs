import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";
import { collectDomSnapshot } from "../collect.mjs";
import { enrichDomSnapshot } from "./collect.mjs";
const pages = [
  {
    id: "dandadan-netflix",
    work: "dandadan",
    url: "https://www.netflix.com/kr/title/81736884",
  },
  {
    id: "spy-family-apple",
    work: "spy-family",
    url: "https://tv.apple.com/kr/show/스파이-패밀리/umc.cmc.1vuf6gpxnoqci1yey2n13h3nx",
  },
  {
    id: "chainsaw-tving",
    work: "chainsaw-man",
    url: "https://www.tving.com/contents/P001654042",
  },
  {
    id: "demon-slayer-laftel",
    work: "demon-slayer",
    url: "https://laftel.net/item/40587",
  },
  {
    id: "new-search-laftel",
    work: "none-search",
    url: "https://laftel.net/search?keyword=스파이%20패밀리",
  },
  {
    id: "new-help-netflix",
    work: "none-help",
    url: "https://help.netflix.com/ko/node/47765",
  },
];
// --only=<id> replaces one capture before the dataset is frozen, preserving other captures.
const only = process.argv.find((x) => x.startsWith("--only="))?.slice(7);
const snapshots = only
  ? JSON.parse(
      await readFile(
        "eval/tiny-decision/v2/data/holdout-observations.json",
        "utf8",
      ),
    )
  : [];
await mkdir(".tmp/tiny-dom-v2-holdout", { recursive: true });
await mkdir("eval/tiny-decision/v2/data", { recursive: true });
const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  for (const item of pages) {
    if (only && item.id !== only) continue;
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      locale: "ko-KR",
    });
    let error;
    try {
      await page.goto(item.url, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await page.waitForTimeout(4500);
    } catch (e) {
      error = e.message;
    }
    const html = await page.content();
    const snapshot = await page.evaluate(
      ({ base, rich }) => {
        const collect = (0, eval)(`(${base})`);
        const enrich = (0, eval)(`(${rich})`);
        return enrich(
          document,
          location.href,
          collect(document, location.href),
        );
      },
      {
        base: collectDomSnapshot.toString(),
        rich: enrichDomSnapshot.toString(),
      },
    );
    const captured = {
      ...item,
      ...snapshot,
      capturedAt: new Date().toISOString(),
      htmlSha256: createHash("sha256").update(html).digest("hex"),
      error,
    };
    const previous = snapshots.findIndex((s) => s.id === item.id);
    if (previous >= 0) snapshots[previous] = captured;
    else snapshots.push(captured);
    await writeFile(`.tmp/tiny-dom-v2-holdout/${item.id}.html`, html);
    await page.screenshot({
      path: `.tmp/tiny-dom-v2-holdout/${item.id}.png`,
      fullPage: false,
    });
    await writeFile(
      "eval/tiny-decision/v2/data/holdout-observations.json",
      JSON.stringify(snapshots, null, 2) + "\n",
    );
    console.log(
      JSON.stringify({
        id: item.id,
        counts: Object.fromEntries(
          Object.entries(snapshot.fields).map(([k, v]) => [k, v.length]),
        ),
        captured: true,
        error,
      }),
    );
    await page.close();
  }
} finally {
  await browser.close();
}
