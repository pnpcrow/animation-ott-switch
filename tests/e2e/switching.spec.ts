import {
  test,
  expect,
  chromium,
  type BrowserContext,
  type Page,
  type Worker,
} from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { removeTestProfile } from "./profile";

type FixtureMode =
  "exact" | "mismatch" | "ambiguous" | "literal" | "literal-mismatch";
let context: BrowserContext;
let profile: string;
let source: Page;
let worker: Worker;
let mode: FixtureMode;
let searchQueries: string[];
const sourceUrl = "https://www.crunchyroll.com/series/GTEST123/frieren";
const titleUrl = "https://www.netflix.com/title/900001";
const secondTitleUrl = "https://www.netflix.com/title/900002";

function sourceHtml() {
  return `<!doctype html><html><head><title>Watch Frieren | Crunchyroll</title><meta property="og:title" content="Watch Frieren | Crunchyroll"><meta property="og:url" content="${sourceUrl}"><meta property="og:description" content="A mage begins a new journey."></head><body><h1>Watch Frieren</h1></body></html>`;
}
function searchHtml() {
  const cards = mode.startsWith("literal")
    ? [
        `<article><a href="/title/900099"><img alt="포스터"></a><button onclick="location.assign('/title/900001')"><h3>Frieren</h3></button></article>`,
      ]
    : [
        '<div class="title-card"><a href="/title/900099"><span class="fallback-text">Frieren Season 2</span></a></div>',
        '<div class="title-card"><a href="/title/900001"><span class="fallback-text">Frieren</span></a></div>',
        ...(mode === "ambiguous"
          ? [
              '<div class="title-card"><a href="/title/900002"><span class="fallback-text">Frieren</span></a></div>',
            ]
          : []),
      ];
  return `<!doctype html><html><head><title>Netflix Search</title></head><body><main id="results" class="search-results"><p>Loading results</p></main><script>setTimeout(() => { document.getElementById('results').innerHTML = ${JSON.stringify(cards.join(""))}; }, 250);</script></body></html>`;
}
function detailHtml(url: string) {
  const title = mode.endsWith("mismatch") ? "A Different Story" : "Frieren";
  return `<!doctype html><html><head><title>${title} | Netflix</title><meta property="og:title" content="${title} | Netflix"><meta property="og:url" content="${url}"><meta property="og:description" content="A verified fixture detail."></head><body><h1>${title}</h1></body></html>`;
}

test.beforeEach(async () => {
  mode = "exact";
  searchQueries = [];
  profile = await mkdtemp(join(tmpdir(), "ott-switch-navigation-"));
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${resolve("dist")}`,
      `--load-extension=${resolve("dist")}`,
    ],
    viewport: { width: 1440, height: 960 },
  });
  worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  await worker.evaluate(() => {
    globalThis.fetch = async () =>
      new Response("Authenticated rendering required", { status: 401 });
    // Chromium extension-created tabs can issue their first request before Playwright
    // attaches request interception. Stage only that initial navigation through a blank tab.
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
  await context.route("https://**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.href === sourceUrl)
      return route.fulfill({ contentType: "text/html", body: sourceHtml() });
    if (url.hostname === "www.netflix.com" && url.pathname === "/search") {
      searchQueries.push(url.searchParams.get("q") ?? "");
      return route.fulfill({ contentType: "text/html", body: searchHtml() });
    }
    if (
      url.hostname === "www.netflix.com" &&
      /^\/title\/90000[12]$/.test(url.pathname)
    )
      return route.fulfill({
        contentType: "text/html",
        body: detailHtml(url.origin + url.pathname),
      });
    return route.fulfill({
      status: 403,
      contentType: "text/plain",
      body: "Unexpected network blocked in test",
    });
  });
  source = await context.newPage();
  await source.goto(sourceUrl);
  await source.bringToFront();
  await source
    .getByRole("button", { name: "AniOTT Switch 열기", exact: true })
    .click();
  await expect(
    source.getByRole("heading", { name: "Frieren", exact: true }),
  ).toBeVisible();
  await expect(
    source.getByRole("button", { name: "Netflix에서 제목 확인 후 이동" }),
  ).toBeEnabled();
  // With no subscriptions selected, merely opening the overlay never opens helper tabs.
  expect(searchQueries).toEqual([]);
});
test.afterEach(async () => {
  await context?.close();
  if (profile) await removeTestProfile(profile);
});

test("matches hydrated results, verifies the detail and switches directly without Watch in the query", async () => {
  const helperCreated = context.waitForEvent("page");
  await source
    .getByRole("button", { name: "Netflix에서 제목 확인 후 이동" })
    .click();
  const helper = await helperCreated;
  await helper.waitForURL("https://www.netflix.com/search?*", {
    timeout: 5000,
  });
  const tabs = await worker.evaluate(() => chrome.tabs.query({}));
  expect(
    tabs.find((tab) => tab.url?.includes("netflix.com/search"))?.active,
  ).toBe(false);
  await expect(
    source
      .locator(".switch-service")
      .filter({ has: source.getByText("Netflix", { exact: true }) })
      .getByRole("link", { name: "스위치" }),
  ).toHaveAttribute("href", titleUrl, { timeout: 15000 });
  await expect.poll(() => helper.isClosed()).toBe(true);
  await expect
    .poll(
      () => context.pages().filter((page) => page.url() === titleUrl).length,
    )
    .toBe(1);
  expect(
    context.pages().some((page) => page.url().includes("netflix.com/search")),
  ).toBe(false);
  expect(searchQueries).toEqual(["Frieren"]);
});

test("does not open a result whose detail title differs from the searched title", async () => {
  mode = "mismatch";
  const helperCreated = context.waitForEvent("page");
  await source
    .getByRole("button", { name: "Netflix에서 제목 확인 후 이동" })
    .click();
  const helper = await helperCreated;
  await expect(
    source
      .getByText(
        "검색 결과와 상세 작품의 제목·연도가 다릅니다. 자동으로 이동하지 않았습니다.",
      )
      .first(),
  ).toBeVisible({ timeout: 15000 });
  await expect.poll(() => helper.isClosed()).toBe(true);
  expect(
    context
      .pages()
      .some((page) => page.url().startsWith("https://www.netflix.com/")),
  ).toBe(false);
  expect(source.url()).toBe(sourceUrl);
  expect(searchQueries).toEqual(["Frieren"]);
});

test("uses a literal JS work URL without borrowing its heading for a neighboring poster", async () => {
  mode = "literal";
  await source
    .getByRole("button", { name: "Netflix에서 제목 확인 후 이동" })
    .click();
  await expect(
    source
      .locator(".switch-service")
      .filter({ has: source.getByText("Netflix", { exact: true }) })
      .getByRole("link", { name: "스위치" }),
  ).toHaveAttribute("href", titleUrl, { timeout: 15000 });
  await expect
    .poll(
      () => context.pages().filter((page) => page.url() === titleUrl).length,
    )
    .toBe(1);
  expect(searchQueries).toEqual(["Frieren"]);
});

test("still verifies the actual detail behind a literal JS work URL", async () => {
  mode = "literal-mismatch";
  const helperCreated = context.waitForEvent("page");
  await source
    .getByRole("button", { name: "Netflix에서 제목 확인 후 이동" })
    .click();
  const helper = await helperCreated;
  await expect(
    source
      .getByText(
        "검색 결과와 상세 작품의 제목·연도가 다릅니다. 자동으로 이동하지 않았습니다.",
      )
      .first(),
  ).toBeVisible({ timeout: 15000 });
  await expect.poll(() => helper.isClosed()).toBe(true);
  expect(
    context
      .pages()
      .some((page) => page.url().startsWith("https://www.netflix.com/")),
  ).toBe(false);
  expect(source.url()).toBe(sourceUrl);
});

test("keeps matching versions ambiguous until the selected detail has been verified", async () => {
  mode = "ambiguous";
  await source
    .getByRole("button", { name: "Netflix에서 제목 확인 후 이동" })
    .click();
  const candidates = source
    .locator(".switch-service")
    .filter({ has: source.getByText("Netflix", { exact: true }) })
    .locator("details");
  await expect(candidates.getByText("작품 후보 2개 확인")).toBeVisible({
    timeout: 15000,
  });
  await expect
    .poll(
      () =>
        context
          .pages()
          .filter((page) => page.url().startsWith("https://www.netflix.com/"))
          .length,
    )
    .toBe(0);
  await candidates.locator("summary").click();
  await candidates
    .getByRole("button", { name: "이 작품으로 이동" })
    .nth(1)
    .click();
  await expect
    .poll(
      () =>
        context.pages().filter((page) => page.url() === secondTitleUrl).length,
      { timeout: 15000 },
    )
    .toBe(1);
  await expect(
    source
      .locator(".switch-service")
      .filter({ has: source.getByText("Netflix", { exact: true }) })
      .getByRole("link", { name: "스위치" }),
  ).toHaveAttribute("href", secondTitleUrl);
  expect(context.pages().some((page) => page.url() === titleUrl)).toBe(false);
  expect(searchQueries).toEqual(["Frieren"]);
});

test("leaves a verification tab alone after the user activates it", async () => {
  const helperCreated = context.waitForEvent("page");
  await source
    .getByRole("button", { name: "Netflix에서 제목 확인 후 이동" })
    .click();
  const helper = await helperCreated;
  await helper.waitForURL("https://www.netflix.com/search?*", {
    timeout: 5000,
  });
  await helper.bringToFront();
  await expect(
    source
      .getByText(
        "검색 확인이 중단되었습니다. 사용자가 선택하거나 이동한 탭은 그대로 유지합니다.",
      )
      .first(),
  ).toBeVisible({ timeout: 5000 });
  expect(helper.isClosed()).toBe(false);
  expect(helper.url()).toBe("https://www.netflix.com/search?q=Frieren");
  expect(context.pages().some((page) => page.url() === titleUrl)).toBe(false);
});
