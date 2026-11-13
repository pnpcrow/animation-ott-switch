import { chromium, expect } from "@playwright/test";
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, dirname, basename } from "node:path";
import { verifyProjectIdentity } from "./verify-identity.mjs";

// Capture the installed extension with public, verified catalogue metadata and
// original OTT key visuals. The library is curated in an isolated test profile.
await verifyProjectIdentity({ root: process.cwd(), includeDist: true });
const catalogue = JSON.parse(
  await readFile("assets/store/catalogue-sources.json", "utf8"),
);
const entries = catalogue.entries;
if (!Array.isArray(entries) || entries.length < 6)
  throw new Error("Six verified catalogue entries are required");
const output = resolve("assets/store");
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "ott-switch-store-assets-"));
const extension = resolve("dist");
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: true,
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
  ],
});
const sourceUrl = entries[0].url;
const errors = [];
try {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker");
  const id = new URL(worker.url()).host;
  if (id !== "cmaijknliglhgokkmijggladebokgafl")
    throw new Error("Unexpected extension ID");
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`chrome-extension://${id}/library.html`);
  const rpc = (action, args = []) =>
    page.evaluate(
      async ({ action, args }) => {
        const result = await chrome.runtime.sendMessage({
          channel: "ott-switch",
          action,
          args,
        });
        if (!result.ok) throw new Error(result.error);
        return result.data;
      },
      { action, args },
    );
  const category = await rpc("saveCategory", ["판타지", "#b7a2f4"]);
  await rpc("saveCategory", ["다시 보고 싶은 작품", "#78c9d3"]);
  await rpc("updateSettings", [{ subscribedProviders: ["laftel"] }]);
  for (let i = entries.length - 1; i >= 0; i--) {
    const bookmark = await rpc("saveBookmark", [
      {
        page: {
          title: entries[i].title,
          description: entries[i].description,
          imageUrl: entries[i].imageUrl,
          provider: entries[i].provider,
          url: entries[i].url,
          aliases: entries[i].aliases,
          year: entries[i].year,
        },
        categoryIds: [i % 2 ? "watchlist" : category.id],
      },
    ]);
    await rpc("updateBookmark", [
      bookmark.id,
      {
        favorite: i === 0 || i === 2,
        notes: i === 0 ? "주말에 이어 보기" : "",
      },
    ]);
  }
  await page.reload();
  await page
    .getByRole("heading", { name: entries[0].title, exact: true })
    .waitFor();
  await page.evaluate(() =>
    Promise.all(
      [...document.images].map((img) => img.decode().catch(() => {})),
    ),
  );
  await page.screenshot({
    path: join(output, "01-library-1280x800.png"),
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "작품 정보 편집", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "작품 정보 편집", exact: true })
    .waitFor();
  await page.screenshot({
    path: join(output, "02-edit-1280x800.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page
    .getByRole("dialog", { name: "보관함 설정", exact: true })
    .waitFor();
  for (const name of ["라프텔", "Netflix", "Prime Video"]) {
    await page
      .getByRole("dialog")
      .getByRole("checkbox", { name, exact: true })
      .check();
  }
  await page.screenshot({
    path: join(output, "03-settings-1280x800.png"),
    animations: "disabled",
  });
  const site = await context.newPage();
  const providerPageErrors = [];
  site.on("pageerror", (error) => providerPageErrors.push(error.message));
  await site.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await site
    .getByRole("heading", { name: entries[0].title, exact: true })
    .first()
    .waitFor({ timeout: 30000 });
  await site
    .getByRole("button", { name: "AniOTT Switch 열기", exact: true })
    .click();
  await site
    .getByRole("complementary", { name: "AniOTT Switch 작품 패널" })
    .waitFor();
  const overlayImage = site.locator(".switch-hero img");
  await expect(overlayImage).toBeVisible();
  await overlayImage.evaluate((img) => img.decode());
  await expect(
    site.getByRole("button", { name: "OTT 다시 확인", exact: true }),
  ).toBeEnabled({ timeout: 120000 });
  await site.screenshot({
    path: join(output, "04-overlay-1280x800.png"),
    animations: "disabled",
  });
  const wavveAction = site.getByRole("button", {
    name: "웨이브에서 제목 확인 후 이동",
    exact: true,
  });
  await wavveAction.click();
  await expect(
    site.getByRole("button", { name: "OTT 다시 확인", exact: true }),
  ).toBeEnabled({ timeout: 120000 });
  await expect(
    site
      .locator(".switch-service")
      .filter({ hasText: "웨이브" })
      .getByText("작품 페이지 확인", { exact: true }),
  ).toBeVisible();
  await site
    .locator(".switch-service")
    .filter({ hasText: "웨이브" })
    .evaluate((element) => {
      element.scrollIntoView({ block: "center" });
    });
  await site.screenshot({
    path: join(output, "05-switch-1280x800.png"),
    animations: "disabled",
  });
  const mark = await readFile("assets/brand/aniott-mark.svg", "utf8");
  const promo = await context.newPage();
  for (const [width, height, filename] of [
    [440, 280, "promo-small-440x280.png"],
    [1400, 560, "promo-marquee-1400x560.png"],
  ]) {
    await promo.setViewportSize({ width, height });
    await promo.setContent(
      `<style>*{box-sizing:border-box}body{margin:0;width:100vw;height:100vh;background:#17232c;color:#faf4e8;font-family:'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;gap:${width < 500 ? 22 : 64}px;overflow:hidden}body:before{content:'';position:absolute;width:90vw;height:90vw;border:1px solid #354954;border-radius:50%;z-index:-1;left:40vw;top:-20vw}.icon{width:${width < 500 ? 112 : 230}px;transform:rotate(-5deg)}svg{display:block;width:100%;height:auto}h1{font-size:${width < 500 ? 38 : 92}px;line-height:1.08;margin:0;font-weight:700;letter-spacing:-1.6px}h1 span{color:#f4bc64}p{margin:16px 0 0;font-size:${width < 500 ? 16 : 28}px;color:#b6c6cd}</style><div class="icon">${mark}</div><div><h1>AniOTT<br><span>Switch</span></h1><p>작품 보관부터 OTT 이동까지</p></div>`,
    );
    await promo.screenshot({
      path: join(output, filename),
      animations: "disabled",
    });
  }
  const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));
  await writeFile(
    join(output, "capture-provenance.json"),
    JSON.stringify(
      {
        version: manifest.version,
        extensionId: id,
        viewport: { width: 1280, height: 800 },
        capturedAt: new Date().toISOString(),
        actualInstalledExtension: true,
        syntheticCatalogAndArtwork: false,
        syntheticProviderPage: false,
        curatedExampleLibrary: true,
        sourcePageUrl: sourceUrl,
        sourcePageTitle: await site.title(),
        catalogueSources: "catalogue-sources.json",
        providerPageErrorCount: providerPageErrors.length,
        requestedLiveSwitchProvider: "wavve",
        observedServiceLabels: await site
          .locator(".switch-service")
          .allTextContents(),
        userProfileUsed: false,
        liveExternalNetwork: true,
        pageErrors: errors,
        note: "Actual extension UI, official OTT key visuals and live Laftel detail page. Categories and notes are curated for the screenshots. No account/profile data, fabricated work links or overridden search responses. Title-page existence is not a guarantee of subscription inclusion or regional playback rights.",
      },
      null,
      2,
    ) + "\n",
  );
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "Store assets captured from the installed extension in assets/store.",
  );
} finally {
  await context.close();
  const target = await realpath(profile);
  if (
    dirname(target) !== (await realpath(tmpdir())) ||
    !basename(target).startsWith("ott-switch-store-assets-")
  )
    throw new Error("Unexpected temporary profile path");
  await rm(target, { recursive: true, force: true });
}
