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

const primeTitle = "수수께끼 풀이는 저녁식사 후에";
const witchTitle = "어느 마녀가 죽을 때까지";
const primeUrl = "https://www.primevideo.com/detail/B012345678";
const laftelUrl = "https://laftel.net/item/42783";
let context: BrowserContext;
let profile: string;

test.beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), "ott-switch-prime-search-"));
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
      new Response("Offline fixture", { status: 403 });
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
    let body: string;
    if (url.href === primeUrl) {
      // The visible title is an image; the textual fallback has a Korean service prefix.
      body = `<title>프라임 비디오: ${primeTitle}</title><meta property="og:title" content="프라임 비디오: ${primeTitle}"><meta property="og:url" content="${primeUrl}"></head><body><main><h1><img src="https://images.example/title.png" alt="${primeTitle}"></h1></main>`;
    } else if (url.href === laftelUrl) {
      body = `<title>${witchTitle} | 라프텔</title><meta property="og:title" content="${witchTitle}"><meta property="og:url" content="${laftelUrl}"></head><body><h1>${witchTitle}</h1>`;
    } else if (
      url.hostname === "www.primevideo.com" &&
      /\/search$/.test(url.pathname)
    ) {
      body = `<title>프라임 비디오 검색</title></head><body><main><form method="get" action="/-/ko/search"><label for="phrase">검색</label><input id="phrase" name="phrase" type="search" value=""><button type="submit">검색하기</button></form><p>URL의 검색 결과가 표시되는 화면</p></main><script>
        window.primeFormEvents = { submit: 0, focus: 0 };
        document.querySelector('form').addEventListener('submit', (event) => { event.preventDefault(); window.primeFormEvents.submit++; });
        document.querySelector('input').addEventListener('focus', () => window.primeFormEvents.focus++);
      </script>`;
    } else {
      body =
        "<title>Search fixture</title></head><body><main>Search results</main>";
    }
    return route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html><head><meta charset="utf-8">${body}</body></html>`,
    });
  });
});

test.afterEach(async () => {
  await context?.close();
  if (profile) await removeTestProfile(profile);
});

async function overlay(url: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(url);
  await page.bringToFront();
  await page
    .getByRole("button", { name: "AniOTT Switch 열기", exact: true })
    .click();
  return page;
}

test("Prime's Korean brand prefix is absent from every outgoing direct-search keyword", async () => {
  const source = await overlay(primeUrl);
  await expect(
    source
      .getByRole("complementary", { name: "AniOTT Switch 작품 패널" })
      .getByRole("heading", { name: primeTitle, exact: true }),
  ).toBeVisible();
  const directLinks = source.locator(
    '.switch-service-actions a[aria-label$="직접 검색"]',
  );
  await expect(directLinks).toHaveCount(9);
  const targets = await directLinks.evaluateAll((links) =>
    links.map((link) => (link as HTMLAnchorElement).href),
  );
  for (const target of targets) {
    expect([...new URL(target).searchParams.values()]).toContain(primeTitle);
    expect(decodeURIComponent(target)).not.toContain("프라임 비디오:");
  }
  const opened = context.waitForEvent("page");
  await source
    .getByRole("link", { name: "라프텔 직접 검색", exact: true })
    .click();
  const search = await opened;
  await search.waitForURL("https://laftel.net/search?*");
  expect(new URL(search.url()).searchParams.get("keyword")).toBe(primeTitle);
});

test("a sidebar Prime search mirrors its URL keyword once without submitting or overwriting edits", async () => {
  const source = await overlay(laftelUrl);
  const direct = source.getByRole("link", {
    name: "Prime Video 직접 검색",
    exact: true,
  });
  await expect(direct).toHaveAttribute(
    "href",
    `https://www.primevideo.com/search?phrase=${encodeURIComponent(witchTitle)}`,
  );
  const opened = context.waitForEvent("page");
  await direct.click();
  const search = await opened;
  await search.waitForURL("https://www.primevideo.com/search?*");
  const input = search.getByRole("searchbox", { name: "검색", exact: true });
  await expect(input).toHaveValue(witchTitle);
  expect(
    await search.evaluate(
      () =>
        (
          window as typeof window & {
            primeFormEvents: { submit: number; focus: number };
          }
        ).primeFormEvents,
    ),
  ).toEqual({ submit: 0, focus: 0 });
  expect(await input.evaluate((node) => node === document.activeElement)).toBe(
    false,
  );
  await input.fill("");
  // The content-script refresh interval must not refill a user's deliberate clearing.
  await search.waitForTimeout(1600);
  await expect(input).toHaveValue("");
  expect(
    await search.evaluate(
      () =>
        (window as typeof window & { primeFormEvents: { submit: number } })
          .primeFormEvents.submit,
    ),
  ).toBe(0);
  expect(new URL(search.url()).searchParams.get("phrase")).toBe(witchTitle);
});
