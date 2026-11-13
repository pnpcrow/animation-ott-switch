import {
  test,
  expect,
  chromium,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { removeTestProfile } from "./profile";

let context: BrowserContext;
let profile: string;
let page: Page;
const heroImage = "https://thumbnail.laftel.net/items/frieren-test.jpg";
const baseSearchHtml = `<!doctype html><html><head><title>검색</title><meta property="og:title" content="잘못된 배경 검색 제목"><meta property="og:description" content="배경 검색 페이지 소개"><meta property="og:image" content="https://thumbnail.laftel.net/items/background-test.jpg"><script type="application/ld+json">{"@type":"TVSeries","name":"Unrelated Recommendation","datePublished":"1999-01-01","description":"Wrong background description"}</script></head><body><h1>검색 결과</h1></body></html>`;
const primeHtml = `<!doctype html><html><head><title>Prime Video: Frieren</title><meta property="og:title" content="Frieren"><meta property="og:description" content="A new journey after the adventure."></head><body><h1>Frieren</h1><div class="hero-preview" id="hero"><img src="${heroImage}" alt="Frieren poster" style="width:720px;height:405px"></div></body></html>`;

test.beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), "ott-switch-modal-preview-"));
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${resolve("dist")}`,
      `--load-extension=${resolve("dist")}`,
    ],
    viewport: { width: 1440, height: 960 },
  });
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker");
  await worker.evaluate(() => {
    globalThis.fetch = async () =>
      new Response("Offline fixture", { status: 403 });
  });
  await context.route("https://**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "thumbnail.laftel.net")
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="405"><rect width="720" height="405" fill="#142b39"/></svg>',
      });
    if (url.hostname === "laftel.net")
      return route.fulfill({ contentType: "text/html", body: baseSearchHtml });
    if (url.hostname === "www.netflix.com")
      return route.fulfill({
        contentType: "text/html",
        body:
          url.pathname === "/title/789"
            ? '<!doctype html><html><head><title>Standalone Film | Netflix</title><meta property="og:title" content="Standalone Film"><meta property="og:description" content="Standalone film synopsis."></head><body><h1>Standalone Film</h1></body></html>'
            : baseSearchHtml,
      });
    if (url.hostname === "www.primevideo.com")
      return route.fulfill({ contentType: "text/html", body: primeHtml });
    return route.fulfill({
      status: 403,
      body: "Unexpected external request blocked",
    });
  });
  page = await context.newPage();
});
test.afterEach(async () => {
  await context?.close();
  if (profile) await removeTestProfile(profile);
});

async function openLaftelModal(id: string, title: string, summary: string) {
  await page.evaluate(
    ({ id, title, summary, heroImage }) => {
      document.querySelector("#item-modal")?.remove();
      history.pushState({}, "", `/search?keyword=frieren&modal=${id}`);
      const modal = document.createElement("div");
      modal.id = "item-modal";
      modal.innerHTML = `<h1 class="ItemInfoHeader__Title-sc-test">${title}</h1><span class="ItemInfoBody__SummaryText-sc-test">${summary}</span><video class="DynamicItemVideo__Video-sc-test" muted autoplay loop playsinline poster="${heroImage}" style="width:720px;height:405px"></video><nav><a href="/search?keyword=frieren&modal=${id}&route=episode">에피소드</a></nav><a href="/player/${id}/65123">작품 재생</a>`;
      document.body.append(modal);
    },
    { id, title, summary, heroImage },
  );
}
async function openNetflixModal(id: string, title: string, route: string) {
  await page.evaluate(
    ({ id, title, route, heroImage }) => {
      document.querySelector(".previewModal--container")?.remove();
      history.pushState({}, "", route);
      const modal = document.createElement("div");
      modal.className = "previewModal--container";
      modal.dataset.videoid = id;
      modal.innerHTML = `<img class="previewModal--player-titleTreatment-logo" alt="${title}" src="${heroImage}"><img class="previewModal--player-background" src="${heroImage}"><p class="previewModal--text">${title} modal synopsis.</p>`;
      document.body.append(modal);
    },
    { id, title, route, heroImage },
  );
}

test("Laftel search modal creates a sidebar from modal metadata and clears it on close", async () => {
  await page.goto("https://laftel.net/search?keyword=frieren");
  const trigger = page.getByRole("button", {
    name: "OTT Switch 열기",
    exact: true,
  });
  await expect(trigger).toBeHidden();
  await openLaftelModal(
    "41666",
    "장송의 프리렌",
    "모달 안에서 읽은 프리렌 소개.",
  );
  await expect(trigger).toBeVisible();
  await trigger.click();
  const panel = page.getByRole("complementary", {
    name: "OTT Switch 작품 패널",
  });
  await expect(
    panel.getByRole("heading", { name: "장송의 프리렌", exact: true }),
  ).toBeVisible();
  await expect(panel.getByText("모달 안에서 읽은 프리렌 소개.")).toBeVisible();
  await expect(panel.locator(".switch-hero img")).toHaveAttribute(
    "src",
    heroImage,
  );
  await expect(panel.getByText("배경 검색 페이지 소개")).toHaveCount(0);
  await page.evaluate(() =>
    history.pushState(
      {},
      "",
      "/search?keyword=frieren&modal=41666&route=review",
    ),
  );
  await expect(page.locator("#ott-switch-extension")).toHaveAttribute(
    "data-page-url",
    /route=review/,
  );
  await expect(panel).toBeVisible();
  await page.evaluate(() => {
    document.querySelector("#item-modal")?.remove();
    history.pushState({}, "", "/search?keyword=frieren");
  });
  await expect(panel).toBeHidden();
  await expect(trigger).toBeHidden();
  await openLaftelModal("41714", "약사의 혼잣말", "새 모달의 소개.");
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(
    panel.getByRole("heading", { name: "약사의 혼잣말", exact: true }),
  ).toBeVisible();
  await expect(panel.getByText("새 모달의 소개.")).toBeVisible();
  await expect(panel.getByText("모달 안에서 읽은 프리렌 소개.")).toHaveCount(0);
});

test("Netflix search and browse modals ignore unrelated page metadata and standalone details still work", async () => {
  await page.goto("https://www.netflix.com/search?q=frieren");
  const trigger = page.getByRole("button", {
    name: "OTT Switch 열기",
    exact: true,
  });
  await expect(trigger).toBeHidden();
  await openNetflixModal("123", "Frieren", "/search?q=frieren&jbv=123");
  await expect(trigger).toBeVisible();
  await trigger.click();
  const panel = page.getByRole("complementary", {
    name: "OTT Switch 작품 패널",
  });
  await expect(
    panel.getByRole("heading", { name: "Frieren", exact: true }),
  ).toBeVisible();
  await expect(panel.getByText("Frieren modal synopsis.")).toBeVisible();
  await expect(panel.locator(".switch-hero img")).toHaveAttribute(
    "src",
    heroImage,
  );
  await expect(panel.getByText("Unrelated Recommendation")).toHaveCount(0);
  await openNetflixModal("456", "Another Story", "/browse?jbv=456");
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(
    panel.getByRole("heading", { name: "Another Story", exact: true }),
  ).toBeVisible();
  await expect(panel.getByText("Another Story modal synopsis.")).toBeVisible();
  await expect(panel.getByText("Frieren modal synopsis.")).toHaveCount(0);
  await page.goto("https://www.netflix.com/title/789");
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(
    panel.getByRole("heading", { name: "Standalone Film", exact: true }),
  ).toBeVisible();
  await expect(panel.getByText("Standalone film synopsis.")).toBeVisible();
});

test("Prime hero autoplay preserves the sidebar while an actual controlled player hides it", async () => {
  const url = "https://www.primevideo.com/detail/B012345678";
  await page.goto(url);
  const trigger = page.getByRole("button", {
    name: "OTT Switch 열기",
    exact: true,
  });
  await expect(trigger).toBeVisible();
  await page.evaluate(async () => {
    const hero = document.getElementById("hero")!;
    hero.querySelector("img")?.remove();
    const video = document.createElement("video");
    video.muted = true;
    video.autoplay = true;
    video.loop = true;
    video.style.cssText = "width:720px;height:405px";
    video.className = "hero-preview-video";
    const canvas = document.createElement("canvas");
    canvas.width = 720;
    canvas.height = 405;
    const drawing = canvas.getContext("2d")!;
    drawing.fillStyle = "#18394a";
    drawing.fillRect(0, 0, 720, 405);
    video.srcObject = canvas.captureStream(10);
    hero.append(video);
    const timer = setInterval(() => drawing.fillRect(0, 0, 720, 405), 100);
    video.addEventListener("pause", () => clearInterval(timer), { once: true });
    await video.play();
  });
  await expect
    .poll(() =>
      page
        .locator("video")
        .evaluate(
          (video) =>
            !(video as HTMLVideoElement).paused &&
            (video as HTMLVideoElement).readyState >= 2,
        ),
    )
    .toBe(true);
  await expect(trigger).toBeVisible();
  await trigger.click();
  const panel = page.getByRole("complementary", {
    name: "OTT Switch 작품 패널",
  });
  await expect(panel).toBeVisible();
  expect(page.url()).toBe(url);
  await page.evaluate(() => {
    document.querySelector("video")!.controls = true;
  });
  await expect(panel).toBeHidden();
  await page.evaluate(() => document.querySelector("video")!.pause());
  await expect(panel).toBeVisible();
  expect(page.url()).toBe(url);
});
