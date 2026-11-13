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

const koreanTitle = "어느 마녀가 죽을 때까지";
const sourceUrl = "https://www.crunchyroll.com/ko/series/GWATCH123/witch";
let context: BrowserContext;
let profile: string;
let worker: Worker;
let library: Page;
let visibleTitle: string;
let structuredTitle: string;

async function rpc(action: string, args: unknown[] = []) {
  const response = await library.evaluate(
    ({ action, args }) =>
      chrome.runtime.sendMessage({ channel: "ott-switch", action, args }),
    { action, args },
  );
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

async function queries(): Promise<string[]> {
  return worker.evaluate(
    () =>
      (
        globalThis as typeof globalThis & {
          watchRegressionQueries: string[];
        }
      ).watchRegressionQueries,
  );
}

test.beforeEach(async () => {
  visibleTitle = koreanTitle;
  structuredTitle = `Watch ${koreanTitle}`;
  profile = await mkdtemp(join(tmpdir(), "ott-switch-watch-regression-"));
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
    const state = globalThis as typeof globalThis & {
      watchRegressionQueries: string[];
    };
    state.watchRegressionQueries = [];
    globalThis.fetch = async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname === "api.laftel.net") {
        state.watchRegressionQueries.push(
          url.searchParams.get("keyword") ?? "",
        );
        return new Response(JSON.stringify({ count: 0, results: [] }));
      }
      // Legacy saved titles must still be usable when refreshing their source fails.
      return new Response("Source refresh blocked in this fixture", {
        status: 403,
      });
    };
  });
  await context.route("https://**/*", (route) => {
    const url = route.request().url();
    if (url === sourceUrl)
      return route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<!doctype html><html><head><title>Watch ${visibleTitle} | Crunchyroll</title><meta property="og:title" content="Watch ${visibleTitle}"><meta property="og:url" content="${sourceUrl}"><script type="application/ld+json">${JSON.stringify({ "@type": "TVSeries", name: structuredTitle, url: sourceUrl })}</script></head><body><h1>${visibleTitle}</h1></body></html>`,
      });
    return route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: "<!doctype html><html><body><main>Search fixture</main></body></html>",
    });
  });
  library = await context.newPage();
  await library.goto(
    `chrome-extension://${new URL(worker.url()).host}/library.html`,
  );
  await rpc("updateSettings", [{ subscribedProviders: [] }]);
});

test.afterEach(async () => {
  await context?.close();
  if (profile) await removeTestProfile(profile);
});

async function openOverlay() {
  const source = await context.newPage();
  await source.goto(sourceUrl);
  await source
    .getByRole("button", { name: "OTT Switch 열기", exact: true })
    .click();
  return source;
}

test("Korean Watch schema decoration is absent from automatic and clicked direct searches", async () => {
  const source = await openOverlay();
  await expect(
    source
      .getByRole("complementary", { name: "OTT Switch 작품 패널" })
      .getByRole("heading", { name: koreanTitle, exact: true }),
  ).toBeVisible();
  const direct = source.getByRole("link", { name: "라프텔 직접 검색" });
  await expect(direct).toHaveAttribute(
    "href",
    `https://laftel.net/search?keyword=${encodeURIComponent(koreanTitle)}`,
  );
  await expect.poll(queries).toEqual([koreanTitle]);
  const popupPromise = context.waitForEvent("page");
  await direct.click();
  const popup = await popupPromise;
  await popup.waitForURL("https://laftel.net/search?*");
  expect(new URL(popup.url()).searchParams.get("keyword")).toBe(koreanTitle);
});

test("legacy saved Watch titles search cleanly even when source refresh is blocked", async () => {
  const oldTitle = `Watch ${koreanTitle}`;
  await rpc("saveBookmark", [
    {
      page: {
        provider: "crunchyroll",
        url: sourceUrl,
        title: oldTitle,
        aliases: [],
        description: "A legacy bookmark with a decorated source title.",
        imageUrl: "",
      },
      categoryIds: [],
    },
  ]);
  await library.reload();
  await library.getByRole("listitem").filter({ hasText: oldTitle }).click();
  const direct = library.getByRole("link", {
    name: `라프텔에서 ${oldTitle} 검색`,
    exact: true,
  });
  await expect(direct).toHaveAttribute(
    "href",
    `https://laftel.net/search?keyword=${encodeURIComponent(koreanTitle)}`,
  );
  await library.getByRole("button", { name: "다른 OTT 찾기" }).click();
  await expect.poll(queries).toEqual([koreanTitle]);
  await expect(
    library.getByRole("button", { name: "다른 OTT 찾기" }),
  ).toBeEnabled();
  const popupPromise = context.waitForEvent("page");
  await direct.click();
  const popup = await popupPromise;
  await popup.waitForURL("https://laftel.net/search?*");
  expect(new URL(popup.url()).searchParams.get("keyword")).toBe(koreanTitle);
  const saved = (await rpc("snapshot")).bookmarks[0];
  expect(saved.title).toBe(oldTitle);
  expect(saved.links.crunchyroll.title).toBe(oldTitle);
});

test("independent visible titles repair schema labels and preserve genuine Watch words", async () => {
  for (const title of ["Frieren", "Watch Dogs"]) {
    visibleTitle = title;
    structuredTitle = title === "Frieren" ? "Watch Frieren" : title;
    const source = await openOverlay();
    await expect(
      source
        .getByRole("complementary", { name: "OTT Switch 작품 패널" })
        .getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(
      source.getByRole("link", { name: "라프텔 직접 검색" }),
    ).toHaveAttribute(
      "href",
      `https://laftel.net/search?keyword=${encodeURIComponent(title)}`,
    );
    await source.close();
  }
});

test("Crunchyroll to Laftel find-and-switch opens the matching Korean work directly", async () => {
  await worker.evaluate((title) => {
    const state = globalThis as typeof globalThis & {
      watchRegressionQueries: string[];
    };
    globalThis.fetch = async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname === "api.laftel.net") {
        state.watchRegressionQueries.push(
          url.searchParams.get("keyword") ?? "",
        );
        if (state.watchRegressionQueries.length === 1)
          return new Response("First discovery attempt unavailable", {
            status: 403,
          });
        return new Response(
          JSON.stringify({
            count: 1,
            results: [
              {
                id: 123,
                name: title,
                is_expired: false,
                is_viewing: true,
              },
            ],
          }),
        );
      }
      return new Response("Blocked fixture", { status: 403 });
    };
    // Let Playwright attach interception before the extension-created navigation.
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
  }, koreanTitle);
  const source = await openOverlay();
  const find = source.getByRole("button", {
    name: "라프텔에서 제목 확인 후 이동",
  });
  await expect(find).toBeEnabled();
  await find.click();
  await expect
    .poll(() =>
      context
        .pages()
        .some((page) => page.url() === "https://laftel.net/item/123"),
    )
    .toBe(true);
  await expect.poll(queries).toEqual([koreanTitle, koreanTitle]);
  await expect(
    source
      .locator(".switch-service")
      .filter({ has: source.getByText("라프텔", { exact: true }) })
      .getByRole("link", { name: "스위치" }),
  ).toHaveAttribute("href", "https://laftel.net/item/123");
});

test("Watcha find-and-switch never searches a generic Crunchyroll source refresh title", async () => {
  await worker.evaluate(
    ({ sourceUrl }) => {
      const state = globalThis as typeof globalThis & {
        watchRegressionQueries: string[];
        sourceRefreshCount: number;
      };
      state.sourceRefreshCount = 0;
      globalThis.fetch = async (input) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
        );
        if (
          url.hostname === new URL(sourceUrl).hostname &&
          /\/series\/GWATCH123(?:\/|$)/.test(url.pathname)
        ) {
          state.sourceRefreshCount++;
          // Some providers return their generic shell with HTTP 200 at the original URL.
          return new Response(
            '<!doctype html><html><head><title>Crunchyroll: Watch Popular Anime, Play Games &amp; Shop Online</title><meta property="og:title" content="Crunchyroll: Watch Popular Anime, Play Games &amp; Shop Online"></head><body></body></html>',
          );
        }
        if (url.hostname === "watcha.com") {
          state.watchRegressionQueries.push(
            url.searchParams.get("query") ?? "",
          );
          return new Response(
            '<!doctype html><html><body><main><p class="no-results">검색 결과가 없습니다.</p></main></body></html>',
          );
        }
        return new Response("Blocked fixture", { status: 403 });
      };
    },
    { sourceUrl },
  );
  await rpc("saveBookmark", [
    {
      page: {
        provider: "crunchyroll",
        url: sourceUrl,
        title: "Watch Dogs",
        aliases: [],
        description: "A genuine title starting with Watch.",
        imageUrl: "",
      },
      categoryIds: [],
    },
  ]);
  await library.reload();
  await library.getByRole("listitem").filter({ hasText: "Watch Dogs" }).click();
  await library
    .getByRole("button", { name: "왓챠에서 제목 확인 후 이동" })
    .click();
  await expect.poll(queries).toEqual(["Watch Dogs"]);
  expect(
    await worker.evaluate(
      () =>
        (globalThis as typeof globalThis & { sourceRefreshCount: number })
          .sourceRefreshCount,
    ),
  ).toBeGreaterThan(0);
  await expect(
    library.getByRole("button", { name: "왓챠에서 제목 확인 후 이동" }),
  ).toBeDisabled();
  await expect(
    library.getByRole("button", { name: "왓챠에서 제목 확인 후 이동" }),
  ).toContainText("검색 결과 없음");
  expect(
    context.pages().some((page) => page.url().includes("watcha.com")),
  ).toBe(false);
});
