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
const detailUrl =
  "https://www.wavve.com/player/vod?programid=CF02_CF0000000119&landing=season";
let mode: "exact" | "mismatch" | "ambiguous";
let context: BrowserContext;
let profile: string;
let source: Page;
let clicks: string[];
let queries: string[];

function hero(name: string) {
  return `<main><div class="video-wrap"><div class="player-area"><div class="poster-box"><img class="poster-thumb" src="https://image.wavve.com/hero.jpg" alt="${name}"></div></div><div class="video-detail-area"><h1 class="logo-box"><img src="https://image.wavve.com/logo.png" alt="${name}"></h1><div class="detail-info-box player-detail"><div class="content-clamp"><span class="text" aria-label="견습 마녀가 기쁨의 눈물을 모으는 여행을 시작한다.">견습 마녀의 여행...</span></div></div></div></div></main>`;
}
function metadata(name: string) {
  return `<meta data-vue-meta="ssr" property="og:title" content="[wavve]${name}"><meta data-vue-meta="ssr" property="og:description" content="1회 여명 1년의 마녀"><meta data-vue-meta="ssr" property="og:url" content="www.wavve.com/player/vod?programid=CF02_CF0000000119&amp;landing=season">`;
}
function genericHead() {
  return '<meta property="og:title" content="Wavve(웨이브)"><meta property="og:description" content="JUST DIVE! Wavve"><meta property="og:url" content="https://www.wavve.com">';
}
function card(kind: string, image = "poster.jpg") {
  return `<div class="thumb portrait"><a role="button" href="javascript:void(0)" aria-label="${title}" data-fixture-kind="${kind}"><img src="https://image.wavve.com/${image}" alt="${title}"><div class="sub-title" aria-hidden="true">${title}</div></a></div>`;
}
function searchHtml() {
  const nextTitle = mode === "mismatch" ? "다른 마녀 이야기" : title;
  const cards =
    card("program") +
    (mode === "ambiguous" ? card("program-dub", "dub.jpg") : "");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title} : 웨이브 검색결과</title>${genericHead()}</head><body><main><section><h2>프로그램${mode === "ambiguous" ? 2 : 1}</h2>${cards}</section><section><h2>에피소드12</h2>${card("episode")}</section><section><h2>에디터Pick3</h2>${card("editor")}</section></main><script>
    for (const card of document.querySelectorAll('[data-fixture-kind]')) card.addEventListener('click', (event) => {
      event.preventDefault();
      window.recordSearchCard(card.dataset.fixtureKind);
      document.title = ${JSON.stringify(`${nextTitle} : 웨이브`)};
      document.head.insertAdjacentHTML('beforeend', ${JSON.stringify(metadata(nextTitle))});
      history.pushState({}, '', ${JSON.stringify(detailUrl)});
      document.body.innerHTML = ${JSON.stringify(hero(nextTitle))};
    });
  </script></body></html>`;
}
function detailHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title} : 웨이브</title>${genericHead()}${metadata(title)}</head><body>${hero(title)}</body></html>`;
}

test.beforeEach(async () => {
  mode = "exact";
  clicks = [];
  queries = [];
  profile = await mkdtemp(join(tmpdir(), "ott-switch-wavve-"));
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${resolve("dist")}`,
      `--load-extension=${resolve("dist")}`,
    ],
    viewport: { width: 1440, height: 960 },
  });
  await context.exposeBinding("recordSearchCard", (_source, kind: string) =>
    clicks.push(kind),
  );
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  await worker.evaluate(() => {
    globalThis.fetch = async () =>
      new Response("Rendered fixture required", { status: 403 });
    // Attach interception before the first extension-created tab request.
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
    if (url.hostname === "www.wavve.com" && url.pathname === "/search") {
      queries.push(url.searchParams.get("searchWord") || "");
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
    .getByRole("button", { name: "OTT Switch 열기", exact: true })
    .click();
  await expect(
    source.getByRole("button", { name: "웨이브에서 제목 확인 후 이동" }),
  ).toBeEnabled();
});
test.afterEach(async () => {
  await context?.close();
  if (profile) await removeTestProfile(profile);
});

test("Laftel to Wavve opens a URL-less program card and verifies its season destination", async () => {
  const helperCreated = context.waitForEvent("page");
  await source
    .getByRole("button", { name: "웨이브에서 제목 확인 후 이동" })
    .click();
  const helper = await helperCreated;
  await expect.poll(() => helper.isClosed(), { timeout: 15000 }).toBe(true);
  await expect
    .poll(
      () => context.pages().filter((page) => page.url() === detailUrl).length,
    )
    .toBe(1);
  expect(clicks).toEqual(["program"]);
  expect(queries).toEqual([title]);
  await expect(
    source
      .locator(".switch-service")
      .filter({ has: source.getByText("웨이브", { exact: true }) })
      .getByRole("link", { name: "스위치" }),
  ).toHaveAttribute("href", detailUrl);
});

test("Wavve's program card is rejected when its actual detail names a different work", async () => {
  mode = "mismatch";
  const helperCreated = context.waitForEvent("page");
  await source
    .getByRole("button", { name: "웨이브에서 제목 확인 후 이동" })
    .click();
  const helper = await helperCreated;
  await expect.poll(() => helper.isClosed(), { timeout: 15000 }).toBe(true);
  expect(clicks).toEqual(["program"]);
  expect(context.pages().some((page) => page.url() === detailUrl)).toBe(false);
  await expect(
    source
      .getByText(
        "검색 결과와 상세 작품의 제목·연도가 다릅니다. 자동으로 이동하지 않았습니다.",
        { exact: true },
      )
      .first(),
  ).toBeVisible();
});

test("multiple matching Wavve program cards are left for user selection", async () => {
  mode = "ambiguous";
  const helperCreated = context.waitForEvent("page");
  await source
    .getByRole("button", { name: "웨이브에서 제목 확인 후 이동" })
    .click();
  const helper = await helperCreated;
  await expect.poll(() => helper.isClosed(), { timeout: 15000 }).toBe(true);
  expect(clicks).toEqual([]);
  expect(context.pages().some((page) => page.url() === detailUrl)).toBe(false);
  await expect(
    source
      .getByText(
        "같은 제목의 검색 카드가 여러 개입니다. 공식 검색에서 작품을 선택해 주세요.",
        { exact: true },
      )
      .first(),
  ).toBeVisible();
});
