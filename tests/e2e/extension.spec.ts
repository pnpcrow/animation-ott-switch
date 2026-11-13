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
let extensionId: string;
let page: Page;
const titleUrl = "https://laftel.net/item/41666";
const fixture = `<!doctype html><html><head><title>장송의 프리렌 ㅣ 라프텔</title><meta property="og:title" content="장송의 프리렌 ㅣ 라프텔"><meta property="og:description" content="천 년을 살아온 마법사, 프리렌의 새로운 여행."><meta property="og:url" content="${titleUrl}"></head><body style="background:#142226;color:white"><h1>장송의 프리렌</h1><video controls style="width:640px;height:360px"></video></body></html>`;
async function rpc(action: string, args: unknown[] = []) {
  const response = await page.evaluate(
    async ({ action, args }) =>
      chrome.runtime.sendMessage({ channel: "ott-switch", action, args }),
    { action, args },
  );
  if (!response.ok) throw new Error(response.error);
  return response.data;
}
test.beforeAll(async () => {
  profile = await mkdtemp(join(tmpdir(), "ott-switch-e2e-"));
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
      new Response("Offline test fixture", { status: 403 });
  });
  extensionId = new URL(worker.url()).host;
  page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/library.html`);
});
test.afterAll(async () => {
  await context?.close();
  if (profile) await removeTestProfile(profile);
});

test("extension worker persists bookmarks, categories, settings and validates backups", async () => {
  const initial = await rpc("snapshot");
  expect(initial.bookmarks).toHaveLength(0);
  expect(initial.categories).toHaveLength(3);
  const category = await rpc("saveCategory", ["주말에 볼 작품", "#e9b86b"]);
  const bookmark = await rpc("saveBookmark", [
    {
      page: {
        title: "장송의 프리렌",
        description: "천 년을 살아온 마법사의 여행.",
        imageUrl: "",
        provider: "laftel",
        url: titleUrl,
        aliases: [],
        year: 2023,
      },
      categoryIds: [category.id],
    },
  ]);
  await rpc("updateBookmark", [
    bookmark.id,
    { favorite: true, notes: "다음 주말에 보기" },
  ]);
  await rpc("updateSettings", [
    { subscribedProviders: ["laftel", "netflix"], openInNewTab: true },
  ]);
  const exported = await rpc("exportBackup");
  expect(exported.data.bookmarks[0].favorite).toBe(true);
  const group = await rpc("exportBackup", [[category.id]]);
  expect(group.data.bookmarks[0].notes).toBe("");
  await page.reload();
  const reloaded = await rpc("snapshot");
  expect(reloaded.bookmarks[0].title).toBe("장송의 프리렌");
  await expect(page.getByText("장송의 프리렌").first()).toBeVisible();
});

test("overlay detects details, saves custom metadata, hides during playback and on search routes", async () => {
  await rpc("saveBookmark", [
    {
      page: {
        title: "장송의 프리렌",
        description: "천 년을 살아온 마법사의 여행.",
        imageUrl: "",
        provider: "laftel",
        url: titleUrl,
        aliases: [],
      },
      categoryIds: [],
    },
  ]);
  const site = await context.newPage();
  // Real installed content script on a supported origin; the site DOM is deterministic.
  await site.route("https://laftel.net/**", (route) =>
    route.fulfill({ contentType: "text/html", body: fixture }),
  );
  await site.goto(titleUrl);
  const trigger = site.getByRole("button", {
    name: "OTT Switch 열기",
    exact: true,
  });
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(
    site.getByRole("complementary", { name: "OTT Switch 작품 패널" }),
  ).toBeVisible();
  await expect(site.getByText("보관함에 저장됨")).toBeVisible();
  const stored = (await rpc("snapshot")).bookmarks[0];
  await rpc("updateBookmark", [
    stored.id,
    { description: "사용자가 정리한 소개", title: "내 프리렌" },
  ]);
  await expect(site.getByRole("heading", { name: "내 프리렌" })).toBeVisible();
  await expect(site.getByText("사용자가 정리한 소개")).toBeVisible();
  await site.evaluate(async () => {
    const video = document.querySelector("video")!;
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#123456";
    ctx.fillRect(0, 0, 640, 360);
    video.srcObject = canvas.captureStream(10);
    video.muted = true;
    const drawing = setInterval(() => {
      ctx.fillRect(0, 0, 640, 360);
    }, 100);
    video.addEventListener("pause", () => clearInterval(drawing), {
      once: true,
    });
    await video.play();
  });
  await expect(trigger).toBeHidden();
  await expect(site.getByRole("complementary")).toBeHidden();
  await site.evaluate(() => document.querySelector("video")!.pause());
  await expect(site.getByRole("complementary")).toBeVisible();
  await site.evaluate(() =>
    history.pushState({}, "", "/search?keyword=프리렌"),
  );
  await expect(site.getByRole("complementary")).toBeHidden({ timeout: 5000 });
  await site.close();
});

test("library renders safely across viewport sizes", async () => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const current = await rpc("saveBookmark", [
    {
      page: {
        title: "장송의 프리렌",
        description: "마법사의 여행.",
        imageUrl: "",
        provider: "laftel",
        url: titleUrl,
        aliases: [],
      },
      categoryIds: [],
    },
  ]);
  await rpc("updateBookmark", [
    current.id,
    {
      title: "장송의 프리렌",
      description:
        '<img src=x onerror="window.bad=true">\n사람을 알아가기 위한 여행.',
      favorite: true,
    },
  ]);
  await page.reload();
  await expect(page.getByText("장송의 프리렌").first()).toBeVisible();
  await page.screenshot({
    path: "artifacts/library-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 768, height: 960 });
  await page.screenshot({
    path: "artifacts/library-tablet.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(() =>
      Object.prototype.hasOwnProperty.call(window, "bad"),
    ),
  ).toBe(false);
  await page.setViewportSize({ width: 1440, height: 960 });
});
