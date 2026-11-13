import { chromium } from "@playwright/test";
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

// Capture the actual installed extension. All catalog entries and artwork are
// original demonstration data; no personal profile or live OTT data is used.
await verifyProjectIdentity({ root: process.cwd(), includeDist: true });
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
const titles = [
  "별빛 우체국",
  "바람의 도서관",
  "달빛을 걷는 고양이",
  "여름의 궤도",
  "구름 위의 정원",
  "내일의 작은 모험",
];
const palettes = [
  ["#142947", "#e6b669"],
  ["#203c3a", "#c9d49b"],
  ["#30274f", "#dfc4ef"],
  ["#274756", "#f3a77e"],
  ["#334b3a", "#d9dc96"],
  ["#493437", "#e6aa86"],
];
function artwork(index) {
  const [bg, fg] = palettes[index];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="720" viewBox="0 0 960 720"><rect width="960" height="720" fill="${bg}"/><circle cx="670" cy="178" r="92" fill="${fg}"/><g fill="${fg}" opacity=".65"><circle cx="190" cy="110" r="3"/><circle cx="460" cy="65" r="3"/><circle cx="820" cy="295" r="4"/><circle cx="360" cy="230" r="4"/><path d="m198 220 5 18 18 5-18 5-5 18-5-18-18-5 18-5Z"/></g><path d="M0 490 185 310 400 510 610 350 960 600V720H0Z" fill="${fg}" opacity=".15"/><path d="M0 600 300 460 520 600 800 480 960 570V720H0Z" fill="#101c2d" opacity=".65"/><path d="M416 465h128v162H416Z" fill="${fg}" opacity=".75"/><path d="m398 467 82-71 82 71Z" fill="${fg}"/><rect x="463" y="537" width="34" height="90" rx="16" fill="${bg}"/><path d="m480 627-120 93h240Z" fill="${fg}" opacity=".3"/><text x="48" y="660" fill="#fff" opacity=".6" font-family="sans-serif" font-size="18">AniOTT Switch · DEMO ARTWORK</text></svg>`;
}
const demoUrl = "https://laftel.net/item/900001";
const imageUrl = (index) => `https://aniott.invalid/demo-${index}.svg`;
const description =
  "밤하늘의 편지를 배달하는 작은 우체국. 서로 다른 길을 걸어온 친구들이 한 통의 편지를 따라 새로운 여행을 시작합니다. 기능 소개를 위해 만든 가상의 작품과 이미지입니다.";
const demoPage = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${titles[0]} - 라프텔</title><meta property="og:type" content="video.tv_show"><meta property="og:title" content="${titles[0]}"><meta property="og:description" content="${description}"><meta property="og:image" content="${imageUrl(0)}"><style>*{box-sizing:border-box}body{margin:0;background:#101920;color:#f4f2eb;font:18px/1.7 'Segoe UI',sans-serif}.demo{padding:20px 48px;background:#202c35;color:#e9bd75;font-size:16px}.hero{margin-left:470px;padding:56px 48px;max-width:780px}img{width:100%;height:320px;object-fit:cover;border-radius:22px}h1{font-size:42px;margin:22px 0 12px}p{color:#b7c4ca}.tag{color:#e9bd75;font-size:14px;letter-spacing:2px}</style></head><body><div class="demo">AniOTT Switch 기능 소개용 예시 페이지 · 실제 OTT 판매·제공 정보가 아닙니다</div><main class="hero"><img src="${imageUrl(0)}"><div class="tag">DEMO TITLE · 2026</div><h1>${titles[0]}</h1><p>${description}</p></main></body></html>`;
const errors = [];
try {
  await context.route("**/*", (route) => {
    const url = route.request().url();
    const match = url.match(/^https:\/\/aniott\.invalid\/demo-(\d)\.svg$/);
    if (match)
      return route.fulfill({
        contentType: "image/svg+xml",
        body: artwork(Number(match[1])),
      });
    if (url === demoUrl)
      return route.fulfill({ contentType: "text/html", body: demoPage });
    if (/^https?:/.test(url)) return route.abort();
    return route.continue();
  });
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker");
  await worker.evaluate(() => {
    globalThis.fetch = async () =>
      new Response("Demo capture: network disabled", { status: 403 });
  });
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
  const category = await rpc("saveCategory", ["나의 판타지 컬렉션", "#b7a2f4"]);
  await rpc("saveCategory", ["함께 보고 싶은 이야기", "#78c9d3"]);
  for (let i = titles.length - 1; i >= 0; i--) {
    const bookmark = await rpc("saveBookmark", [
      {
        page: {
          title: titles[i],
          description:
            i === 0
              ? description
              : "새로운 이야기를 나만의 카테고리에 모아 두세요. 기능 소개용으로 만든 예시 작품입니다.",
          imageUrl: imageUrl(i),
          provider: "laftel",
          url: `https://laftel.net/item/${900001 + i}`,
          aliases: [],
          year: 2026,
        },
        categoryIds: [i % 2 ? "watchlist" : category.id],
      },
    ]);
    await rpc("updateBookmark", [
      bookmark.id,
      {
        favorite: i === 0 || i === 2,
        notes:
          i === 0
            ? "이번 주말에 이어 볼 이야기. 이미지와 소개도 내가 원하는 내용으로 정리해요."
            : "",
      },
    ]);
  }
  await page.reload();
  await page.getByRole("heading", { name: titles[0], exact: true }).waitFor();
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
    .getByRole("dialog", { name: "내 보관함 설정", exact: true })
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
  site.on("pageerror", (error) => errors.push(error.message));
  await site.goto(demoUrl);
  await site
    .getByRole("button", { name: "AniOTT Switch 열기", exact: true })
    .click();
  await site
    .getByRole("complementary", { name: "AniOTT Switch 작품 패널" })
    .waitFor();
  await site.locator(".demo").evaluate((element) => {
    element.style.paddingLeft = "470px";
    element.style.fontSize = "14px";
  });
  await site.evaluate(() =>
    Promise.all(
      [...document.images].map((img) => img.decode().catch(() => {})),
    ),
  );
  await site.screenshot({
    path: join(output, "04-overlay-1280x800.png"),
    animations: "disabled",
  });
  await site.locator(".switch-services").evaluate((element) => {
    element.scrollIntoView({ block: "start" });
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
      `<style>*{box-sizing:border-box}body{margin:0;width:100vw;height:100vh;background:#17232c;color:#faf4e8;font-family:'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;gap:${width < 500 ? 22 : 64}px;overflow:hidden}body:before{content:'';position:absolute;width:90vw;height:90vw;border:1px solid #354954;border-radius:50%;z-index:-1;left:40vw;top:-20vw}.icon{width:${width < 500 ? 112 : 230}px;transform:rotate(-5deg)}svg{display:block;width:100%;height:auto}h1{font-size:${width < 500 ? 38 : 92}px;line-height:1.08;margin:0;font-weight:700;letter-spacing:-1.6px}h1 span{color:#f4bc64}p{margin:16px 0 0;font-size:${width < 500 ? 16 : 28}px;color:#b6c6cd}</style><div class="icon">${mark}</div><div><h1>AniOTT<br><span>Switch</span></h1><p>내 작품, 내 OTT.</p></div>`,
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
        syntheticCatalogAndArtwork: true,
        syntheticProviderPage: true,
        userProfileUsed: false,
        liveExternalNetwork: false,
        pageErrors: errors,
        note: "Original fictional demo content, not evidence of OTT availability. The screenshot UI is the actual production bundle.",
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
