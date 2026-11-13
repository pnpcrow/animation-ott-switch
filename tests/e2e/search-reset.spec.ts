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

const title = "어느 마녀가 죽을 때까지";
const sourceUrl = "https://laftel.net/item/42783";
const automaticUrl = "https://www.netflix.com/title/81234567";
const manualUrl = "https://watcha.com/ko/contents/tRxq9zz";
let context: BrowserContext;
let profile: string;
let library: Page;
let worker: Worker;

async function rpc(action: string, args: unknown[] = []) {
  const response = await library.evaluate(
    ({ action, args }) =>
      chrome.runtime.sendMessage({ channel: "ott-switch", action, args }),
    { action, args },
  );
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

test.beforeAll(async () => {
  profile = await mkdtemp(join(tmpdir(), "ott-switch-search-reset-"));
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
      resetTestFetches: number;
    };
    state.resetTestFetches = 0;
    globalThis.fetch = async () => {
      state.resetTestFetches++;
      return new Response("Offline test fixture", { status: 403 });
    };
  });
  library = await context.newPage();
  await library.goto(
    `chrome-extension://${new URL(worker.url()).host}/library.html`,
  );
  await context.route("https://**/*", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html><head><meta charset="utf-8"><title>${title} | 라프텔</title><meta property="og:title" content="${title}"><meta property="og:url" content="${sourceUrl}"></head><body><h1>${title}</h1></body></html>`,
    }),
  );
});

test.afterAll(async () => {
  await context?.close();
  if (profile) await removeTestProfile(profile);
});

test("settings reset removes automatic links and stale results in an open overlay while preserving the library", async () => {
  await rpc("updateSettings", [{ subscribedProviders: [] }]);
  const category = await rpc("saveCategory", ["다시 볼 애니메이션", "#b7e27c"]);
  const bookmark = await rpc("saveBookmark", [
    {
      page: {
        title,
        description: "직접 정리한 작품 소개",
        imageUrl: "",
        provider: "laftel",
        url: sourceUrl,
        aliases: [],
      },
      categoryIds: [category.id],
      links: {
        netflix: {
          provider: "netflix",
          url: automaticUrl,
          title,
          verifiedAt: Date.now(),
          source: "search",
        },
        watcha: {
          provider: "watcha",
          url: manualUrl,
          title,
          verifiedAt: Date.now(),
          source: "manual",
        },
      },
    },
  ]);
  await rpc("updateBookmark", [
    bookmark.id,
    { favorite: true, notes: "주말에 이어 보기" },
  ]);
  await library.reload();
  const netflixCard = library
    .locator(".provider-card")
    .filter({ hasText: "Netflix" });
  await expect(
    netflixCard.getByRole("link", { name: "스위치" }),
  ).toHaveAttribute("href", automaticUrl);

  const site = await context.newPage();
  await site.goto(sourceUrl);
  await site
    .getByRole("button", { name: "AniOTT Switch 열기", exact: true })
    .click();
  const panel = site.getByRole("complementary", {
    name: "AniOTT Switch 작품 패널",
  });
  const overlayNetflix = panel
    .locator(".switch-service")
    .filter({ hasText: "Netflix" });
  await expect(
    overlayNetflix.getByRole("link", { name: "스위치" }),
  ).toHaveAttribute("href", automaticUrl);
  await expect(
    panel.getByRole("button", { name: "OTT 다시 확인" }),
  ).toBeEnabled();
  await expect(
    panel.getByRole("button", { name: "검색 결과 초기화", exact: true }),
  ).toBeEnabled();
  const fetchCount = () =>
    worker.evaluate(
      () =>
        (globalThis as typeof globalThis & { resetTestFetches: number })
          .resetTestFetches,
    );
  const searchesBeforeReset = await fetchCount();
  const pagesBeforeReset = context.pages().length;

  await library.getByRole("button", { name: "설정", exact: true }).click();
  const settings = library.getByRole("dialog", { name: "보관함 설정" });
  // Reset is separate from saving settings and must preserve unsaved choices.
  await settings
    .getByRole("checkbox", { name: "Netflix", exact: true })
    .check();
  await settings
    .getByRole("button", { name: "검색 결과 초기화", exact: true })
    .click();
  await expect(settings.getByRole("status")).toContainText(
    "1개 작품의 자동 연결 1개",
  );
  await expect(
    settings.getByRole("checkbox", { name: "Netflix", exact: true }),
  ).toBeChecked();
  await expect(
    overlayNetflix.getByRole("link", { name: "스위치" }),
  ).toHaveCount(0);
  await expect(
    overlayNetflix.getByRole("button", {
      name: "Netflix에서 제목 확인 후 이동",
    }),
  ).toBeEnabled();
  await settings.getByRole("button", { name: "취소", exact: true }).click();
  await expect(netflixCard.getByRole("link", { name: "스위치" })).toHaveCount(
    0,
  );
  await expect(
    library
      .locator(".provider-card")
      .filter({ hasText: "왓챠" })
      .getByRole("link", { name: "스위치" }),
  ).toHaveAttribute("href", manualUrl);

  const after = await rpc("snapshot");
  expect(after.bookmarks).toHaveLength(1);
  expect(after.bookmarks[0]).toMatchObject({
    id: bookmark.id,
    title,
    description: "직접 정리한 작품 소개",
    categoryIds: [category.id],
    favorite: true,
    notes: "주말에 이어 보기",
    links: {
      laftel: { url: sourceUrl, source: "page" },
      watcha: { url: manualUrl, source: "manual" },
    },
  });
  expect(after.bookmarks[0].links.netflix).toBeUndefined();
  expect(after.categories).toContainEqual(category);
  expect(after.settings.subscribedProviders).toEqual([]);
  expect(await fetchCount()).toBe(searchesBeforeReset);
  expect(context.pages()).toHaveLength(pagesBeforeReset);
});
