import { chromium } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";

// Development-only renderer. Runtime icons are committed PNGs, so normal builds
// never need a browser or download artwork from a third party.
const mark = await readFile("assets/brand/aniott-mark.svg", "utf8");
await mkdir("public/icons", { recursive: true });
await mkdir("assets/store", { recursive: true });
const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    const pad = size === 128 ? 16 : 0;
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size - pad * 2}px;height:${size - pad * 2}px;margin:${pad}px}</style>${mark}`,
    );
    await page.screenshot({
      path: `public/icons/icon-${size}.png`,
      omitBackground: true,
    });
    if (size === 128)
      await page.screenshot({
        path: "assets/store/store-icon-128.png",
        omitBackground: true,
      });
  }
} finally {
  await browser.close();
}
console.log("AniOTT Switch icons generated from the original SVG.");
