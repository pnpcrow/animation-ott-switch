import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";
import { collectDomSnapshot } from "../tiny-decision/collect.mjs";
import { enrichDomSnapshot } from "../tiny-decision/v2/collect.mjs";

// This manifest is held out from model/template authors until their settings freeze.
const pages = [
  { id: "violet-netflix", work: "violet-evergarden", url: "https://www.netflix.com/kr/title/80182123", pageKind: "detail" },
  { id: "hero-apple", work: "my-hero-academia", url: "https://tv.apple.com/kr/show/나의-히어로-아카데미아/umc.cmc.q5m1ulm329damie9vyu8ooty", pageKind: "detail" },
  { id: "bebop-tving", work: "cowboy-bebop", url: "https://www.tving.com/contents/P001774558", pageKind: "detail" },
  { id: "tutu-laftel", work: "princess-tutu", url: "https://laftel.net/item/15371", pageKind: "detail" },
  { id: "genre-netflix", work: "none-genre", url: "https://www.netflix.com/kr/browse/genre/6721", pageKind: "genre-index" },
  { id: "policy-laftel", work: "none-policy", url: "https://policy.laftel.net/service/", pageKind: "legal" },
];
const only = process.argv.find(x => x.startsWith("--only="))?.slice(7);
const target = "eval/light-dom/data/holdout-observations.json";
const snapshots = only ? JSON.parse(await readFile(target, "utf8")) : [];
await mkdir(".tmp/light-dom-holdout", { recursive: true });
await mkdir("eval/light-dom/data", { recursive: true });
const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  for (const item of pages) {
    if (only && item.id !== only) continue;
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: "ko-KR" });
    let error;
    try {
      await page.goto(item.url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(4500);
    } catch (e) { error = e.message; }
    const html = await page.content();
    const snapshot = await page.evaluate(({ base, rich }) => {
      const collect = (0, eval)(`(${base})`), enrich = (0, eval)(`(${rich})`);
      return enrich(document, location.href, collect(document, location.href));
    }, { base: collectDomSnapshot.toString(), rich: enrichDomSnapshot.toString() });
    const captured = { ...item, ...snapshot, capturedAt: new Date().toISOString(), htmlSha256: createHash("sha256").update(html).digest("hex"), error };
    const index = snapshots.findIndex(s => s.id === item.id);
    if (index >= 0) snapshots[index] = captured; else snapshots.push(captured);
    await writeFile(`.tmp/light-dom-holdout/${item.id}.html`, html);
    await page.screenshot({ path: `.tmp/light-dom-holdout/${item.id}.png`, fullPage: false });
    await writeFile(target, JSON.stringify(snapshots, null, 2) + "\n");
    console.log(JSON.stringify({ id: item.id, url: snapshot.pageUrl, title: snapshot.documentTitle, counts: Object.fromEntries(Object.entries(snapshot.fields).map(([k,v]) => [k,v.length])), error }));
    await page.close();
  }
} finally { await browser.close(); }
