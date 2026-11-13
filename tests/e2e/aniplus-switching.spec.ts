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

const title = "장송의 프리렌";
const sourceUrl = "https://laftel.net/item/41666";
const detailUrl = "https://www.aniplustv.com/items/3011";
let mode: "exact" | "mismatch" | "ambiguous";
let context: BrowserContext;
let profile: string;
let source: Page;
let clicks: string[];
let queries: string[];

// Minimal public DOM structure from 2026-11-13. Synopsis is synthetic.
function hero(name: string) {
  return `<div class="detail_layer_pop"><div class="detail_view"><div class="baner live_detail"><div class="float_left"><div><img src="https://cdn.example.org/frieren.jpg"></div></div><div class="float_right"><h1>${name}<span>葬送のフリーレン</span></h1><div class="summary_text"><h2>줄거리</h2>마법사의 여행.<br>동료와의 만남.</div></div></div><h1>에피소드<span>총28화</span></h1></div></div>`;
}
function metadata(name: string) {
  return `<meta data-rh="true" property="og:title" content="${name} 애니플러스"><meta data-rh="true" property="og:url" content="${detailUrl}"><meta data-rh="true" property="og:image" content="https://cdn.example.org/frieren.jpg">`;
}
function genericHead() {
  return '<meta property="og:title" content="한일 동시 방영 애니메이션 채널 - 애니플러스"><meta property="og:description" content="홈페이지 광고 문구"><meta property="og:url" content="https://www.aniplustv.com"><meta property="og:image" content="https://www.aniplustv.com/generic.png">';
}
function card(kind: string, name = title, image = "poster.jpg") {
  return `<div class="div_li"><div class="list_img_bg" style="cursor:pointer" data-fixture-kind="${kind}"><img src="https://cdn.example.org/${image}"></div><p>${name} <span>판타지</span></p></div>`;
}
function searchHtml() {
  const nextTitle = mode === "mismatch" ? "다른 마법사의 여행" : title;
  const cards =
    card("original") +
    card("second-season", `${title} 2기`, "season2.jpg") +
    (mode === "ambiguous"
      ? card("dub", `${title}(한국어더빙)`, "dub.jpg")
      : "");
  return `<!doctype html><html><head><meta charset="utf-8"><title>한일 동시방영 채널 - 애니플러스</title>${genericHead()}</head><body><main><div class="vod_list_group"><h1><em>"${title}"</em>에 대한 검색 결과 <span>(${mode === "ambiguous" ? 3 : 2})</span></h1><div class="vod_vod_list">${cards}</div></div><section aria-label="추천 작품">${card("recommendation")}</section></main><script>
    for (const card of document.querySelectorAll('[data-fixture-kind]')) card.addEventListener('click', () => {
      window.recordAniplusCard(card.dataset.fixtureKind);
      document.title = ${JSON.stringify(`${nextTitle} - 애니플러스`)};
      document.head.insertAdjacentHTML('beforeend', ${JSON.stringify(metadata(nextTitle))});
      history.pushState({}, '', ${JSON.stringify(detailUrl)});
      // The real SPA leaves the old search content behind the detail layer.
      document.querySelector('main').style.display = 'none';
      document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(hero(nextTitle))});
    });
  </script></body></html>`;
}
function detailHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title} - 애니플러스</title>${genericHead()}${metadata(title)}</head><body><main style="display:none"><h1>""에 대한 검색 결과 ()</h1></main>${hero(title)}</body></html>`;
}
function serviceCard() {
  return source.locator(".switch-service").filter({
    has: source.getByText("애니플러스", { exact: true }),
  });
}

test.beforeEach(async () => {
  mode = "exact";
  clicks = [];
  queries = [];
  profile = await mkdtemp(join(tmpdir(), "ott-switch-aniplus-"));
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${resolve("dist")}`,
      `--load-extension=${resolve("dist")}`,
    ],
    viewport: { width: 1440, height: 960 },
  });
  await context.exposeBinding("recordAniplusCard", (_source, kind: string) =>
    clicks.push(kind),
  );
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  await worker.evaluate(() => {
    globalThis.fetch = async () =>
      new Response("Rendered fixture required", { status: 403 });
    const create = chrome.tabs.create.bind(chrome.tabs);
    // Give Playwright time to attach request interception to helper/new tabs.
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
    if (url.hostname === "www.aniplustv.com" && url.pathname === "/Search") {
      queries.push(url.searchParams.get("st") || "");
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
    source.getByRole("button", { name: "애니플러스에서 제목 확인 후 이동" }),
  ).toBeEnabled();
});

test.afterEach(async () => {
  await context?.close();
  if (profile) await removeTestProfile(profile);
});

test("Aniplus opens a URL-less work card and verifies its detail layer above stale search content", async () => {
  const helperCreated = context.waitForEvent("page");
  await source
    .getByRole("button", { name: "애니플러스에서 제목 확인 후 이동" })
    .click();
  const helper = await helperCreated;
  await expect.poll(() => helper.isClosed(), { timeout: 15000 }).toBe(true);
  await expect
    .poll(
      () => context.pages().filter((page) => page.url() === detailUrl).length,
    )
    .toBe(1);
  expect(clicks).toEqual(["original"]);
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
    panel.getByText("마법사의 여행. 동료와의 만남.", { exact: true }),
  ).toBeVisible();
});

test("Aniplus rejects a matching search card when its actual detail is another work", async () => {
  mode = "mismatch";
  const helperCreated = context.waitForEvent("page");
  await source
    .getByRole("button", { name: "애니플러스에서 제목 확인 후 이동" })
    .click();
  const helper = await helperCreated;
  await expect.poll(() => helper.isClosed(), { timeout: 15000 }).toBe(true);
  expect(clicks).toEqual(["original"]);
  expect(context.pages().some((page) => page.url() === detailUrl)).toBe(false);
  await expect(serviceCard().getByRole("link", { name: "스위치" })).toHaveCount(
    0,
  );
  await expect(
    source
      .getByText(
        "검색 결과와 상세 작품의 제목·연도가 다릅니다. 자동으로 이동하지 않았습니다.",
        { exact: true },
      )
      .first(),
  ).toBeVisible();
});

test("Aniplus preserves ambiguity between original and Korean dub instead of selecting one", async () => {
  mode = "ambiguous";
  const helperCreated = context.waitForEvent("page");
  await source
    .getByRole("button", { name: "애니플러스에서 제목 확인 후 이동" })
    .click();
  const helper = await helperCreated;
  await expect.poll(() => helper.isClosed(), { timeout: 15000 }).toBe(true);
  expect(clicks).toEqual([]);
  expect(context.pages().some((page) => page.url() === detailUrl)).toBe(false);
  await expect(serviceCard().getByRole("link", { name: "스위치" })).toHaveCount(
    0,
  );
  await expect(
    source
      .getByText(
        "같은 제목의 검색 카드가 여러 개입니다. 공식 검색에서 작품을 선택해 주세요.",
        { exact: true },
      )
      .first(),
  ).toBeVisible();
});
