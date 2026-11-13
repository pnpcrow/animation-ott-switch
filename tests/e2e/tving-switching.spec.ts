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

const title = "어느 마녀가 죽을 때까지";
const sourceUrl = "https://laftel.net/item/42783";
const detailUrl = "https://www.tving.com/contents/P001791654";
let mismatch: boolean;
let context: BrowserContext;
let profile: string;
let source: Page;
let queries: string[];

// Minimal observed markup. The visible card label and title logo identify the
// program; poster alt adds a label and schema adds a selected episode number.
function searchHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>'${title}' 검색 결과 | TVING</title></head><body><main><h2>시리즈(프로그램) 검색 결과</h2><a href="${detailUrl}"><img alt="${title} 포스터" src="https://image.tving.com/witch-poster.jpg"><p class="vertical-item-poster-text-center">${title}</p><span>자막</span></a></main></body></html>`;
}
function detailHtml() {
  const logoTitle = mismatch ? `${title} 2기` : title;
  const episodeTitle = `${title} 1화`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${episodeTitle} | TVING</title><link rel="canonical" href="${detailUrl}"><meta property="og:url" content="${detailUrl}"><meta property="og:title" content="${episodeTitle} | TVING"><meta property="og:image" content="https://image.tving.com/witch-poster.jpg"><script type="application/ld+json">${JSON.stringify({ "@type": "TVSeries", url: detailUrl, name: episodeTitle, description: "마녀의 여행과 만남.", datePublished: "2025-04-01" })}</script></head><body><main><section><h1 class="sr-only">${episodeTitle}</h1><article><h1><picture><img alt="${logoTitle}" src="https://image.tving.com/witch-logo.png"></picture></h1><div class="tag_wrap tag_detail"><div class="tag tag-blank">2025</div><div class="tag">애니메이션</div></div><button data-testid="content-detail-cta-button">이용권 구독하고 시청하기</button></article></section><section><h2>비슷한 콘텐츠</h2><img alt="다른 작품" src="https://image.tving.com/other.jpg"></section></main></body></html>`;
}
function serviceCard() {
  return source.locator(".switch-service").filter({
    has: source.getByText("티빙", { exact: true }),
  });
}

test.beforeEach(async () => {
  mismatch = false;
  queries = [];
  profile = await mkdtemp(join(tmpdir(), "ott-switch-tving-"));
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${resolve("dist")}`,
      `--load-extension=${resolve("dist")}`,
    ],
    viewport: { width: 1440, height: 960 },
  });
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  await worker.evaluate(() => {
    globalThis.fetch = async () =>
      new Response("Rendered fixture required", { status: 403 });
    const create = chrome.tabs.create.bind(chrome.tabs);
    chrome.tabs.create = (async (options: chrome.tabs.CreateProperties) => {
      if (!options.url?.startsWith("https://")) return create(options);
      const tab = await create({ ...options, url: "about:blank" });
      await new Promise((resolve) => setTimeout(resolve, 150));
      return chrome.tabs.update(tab.id!, {
        url: options.url,
        active: options.active,
      });
    }) as typeof chrome.tabs.create;
  });
  const setup = await context.newPage();
  await setup.goto(
    `chrome-extension://${new URL(worker.url()).host}/library.html`,
  );
  await setup.evaluate(() =>
    chrome.runtime.sendMessage({
      channel: "ott-switch",
      action: "updateSettings",
      args: [{ subscribedProviders: [], openInNewTab: true }],
    }),
  );
  await setup.close();
  await context.route("https://**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.href === sourceUrl)
      return route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<!doctype html><html><head><meta charset="utf-8"><title>${title} | 라프텔</title><meta property="og:title" content="${title}"><meta property="og:url" content="${sourceUrl}"></head><body><h1>${title}</h1></body></html>`,
      });
    if (url.hostname === "www.tving.com" && url.pathname === "/search") {
      queries.push(url.searchParams.get("keyword") || "");
      return route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: searchHtml(),
      });
    }
    if (url.href === detailUrl)
      return route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: detailHtml(),
      });
    return route.fulfill({
      status: 403,
      contentType: "text/plain",
      body: "Unexpected fixture request",
    });
  });
  source = await context.newPage();
  await source.goto(sourceUrl);
  await source.bringToFront();
  await source
    .getByRole("button", { name: "AniOTT Switch 열기", exact: true })
    .click();
  await expect(
    source.getByRole("button", { name: "티빙에서 제목 확인 후 이동" }),
  ).toBeEnabled();
});

test.afterEach(async () => {
  await context?.close();
  if (profile) await removeTestProfile(profile);
});

test("Tving verifies a series logo against episode-decorated metadata and opens the exact work", async () => {
  const helperCreated = context.waitForEvent("page");
  await source
    .getByRole("button", { name: "티빙에서 제목 확인 후 이동" })
    .click();
  const helper = await helperCreated;
  await expect.poll(() => helper.isClosed(), { timeout: 15000 }).toBe(true);
  await expect
    .poll(
      () => context.pages().filter((page) => page.url() === detailUrl).length,
    )
    .toBe(1);
  expect(queries).toEqual([title]);
  await expect(
    serviceCard().getByRole("link", { name: "스위치" }),
  ).toHaveAttribute("href", detailUrl);
  const destination = context.pages().find((page) => page.url() === detailUrl)!;
  await destination
    .getByRole("button", { name: "AniOTT Switch 열기", exact: true })
    .click();
  const panel = destination.getByRole("complementary", {
    name: "AniOTT Switch 작품 패널",
  });
  await expect(
    panel.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByText("마녀의 여행과 만남.", { exact: true }),
  ).toBeVisible();
});

test("Tving refuses a stale first-season metadata response with a different season logo", async () => {
  mismatch = true;
  const helperCreated = context.waitForEvent("page");
  await source
    .getByRole("button", { name: "티빙에서 제목 확인 후 이동" })
    .click();
  const helper = await helperCreated;
  await expect.poll(() => helper.isClosed(), { timeout: 20000 }).toBe(true);
  expect(queries).toEqual([title]);
  expect(context.pages().some((page) => page.url() === detailUrl)).toBe(false);
  await expect(serviceCard().getByRole("link", { name: "스위치" })).toHaveCount(
    0,
  );
  await expect(
    source
      .getByText("검색 후보의 작품 상세 정보를 확인하지 못했습니다.", {
        exact: true,
      })
      .first(),
  ).toBeVisible();
});
