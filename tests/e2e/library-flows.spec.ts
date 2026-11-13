import {
  test,
  expect,
  chromium,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { removeTestProfile } from "./profile";

let context: BrowserContext;
let profile: string;
let page: Page;

async function snapshot() {
  return page.evaluate(async () => {
    const response = await chrome.runtime.sendMessage({
      channel: "ott-switch",
      action: "snapshot",
      args: [],
    });
    if (!response.ok) throw new Error(response.error);
    return response.data;
  });
}

test.beforeAll(async () => {
  profile = await mkdtemp(join(tmpdir(), "ott-switch-library-ui-"));
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      "--disable-extensions-except=" + resolve("dist"),
      "--load-extension=" + resolve("dist"),
    ],
    viewport: { width: 1440, height: 960 },
  });
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker");
  await worker.evaluate(() => {
    globalThis.fetch = async () =>
      new Response("Offline test fixture", { status: 403 });
  });
  const extensionId = new URL(worker.url()).host;
  page = await context.newPage();
  await page.goto("chrome-extension://" + extensionId + "/library.html");
});
test.afterAll(async () => {
  await context?.close();
  if (profile) await removeTestProfile(profile);
});

test("library dialogs create and edit titles, save preferences, export and merge imports", async () => {
  await expect(page.getByRole("heading", { name: /^모든 작품/ })).toBeVisible();
  await page
    .getByRole("button", { name: "카테고리 추가", exact: true })
    .click();
  const categoryDialog = page.getByRole("dialog", {
    name: "새 카테고리",
    exact: true,
  });
  await categoryDialog.getByLabel("카테고리 이름").fill("주말의 이야기");
  await categoryDialog
    .getByRole("button", { name: "저장", exact: true })
    .click();
  await expect(categoryDialog).toBeHidden();
  await expect(
    page.getByRole("button", { name: "주말의 이야기", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "작품 추가", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "작품 직접 추가" });
  await dialog.getByLabel("작품 제목", { exact: true }).fill("장송의 프리렌");
  await dialog.getByLabel("OTT", { exact: true }).selectOption("laftel");
  await dialog
    .getByLabel("작품 상세 주소")
    .fill("https://laftel.net/item/41666");
  await dialog
    .getByLabel("작품 소개")
    .fill("긴 여행 끝에서 시작되는, 사람을 알아가는 이야기.");
  await dialog.getByRole("checkbox", { name: "주말의 이야기" }).check();
  await dialog.getByRole("button", { name: "보관함에 담기" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "장송의 프리렌", exact: true }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "작품 정보 편집", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "작품 정보 편집", exact: true });
  await dialog.getByLabel("공개 연도").fill("2023");
  await dialog.getByLabel("작품 메모").fill("금요일 저녁에 이어 보기");
  await dialog.getByRole("button", { name: "변경사항 저장" }).click();
  await expect(dialog).toBeHidden();
  expect((await snapshot()).bookmarks[0].year).toBe(2023);
  await expect(
    page.getByText("금요일 저녁에 이어 보기", { exact: true }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "작품 정보 편집", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "작품 정보 편집", exact: true });
  await dialog.getByLabel("공개 연도").fill("");
  await dialog.getByLabel("작품 제목", { exact: true }).fill("프리렌의 여행");
  await dialog.getByRole("button", { name: "변경사항 저장" }).click();
  await expect(dialog).toBeHidden();
  expect((await snapshot()).bookmarks[0].year).toBeUndefined();
  await expect(
    page.getByRole("heading", { name: "프리렌의 여행", exact: true }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "즐겨찾기 추가", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "즐겨찾기 해제", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "설정", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "보관함 설정", exact: true });
  await expect(dialog.getByRole("checkbox")).toHaveCount(11);
  await dialog.getByRole("checkbox", { name: "Netflix", exact: true }).check();
  await dialog.getByRole("checkbox", { name: "라프텔", exact: true }).check();
  await dialog.getByRole("button", { name: "저장", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect((await snapshot()).settings.subscribedProviders).toEqual(
    expect.arrayContaining(["netflix", "laftel"]),
  );

  await page.getByRole("button", { name: "내보내기", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "보관함 내보내기", exact: true });
  const downloaded = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "JSON 내보내기" }).click();
  const download = await downloaded;
  const path = await download.path();
  expect(path).not.toBeNull();
  const backup = JSON.parse(await readFile(path!, "utf8"));
  expect(backup.format).toBe("ott-switch");
  expect(backup.data.bookmarks[0].notes).toBe("금요일 저녁에 이어 보기");
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "내보내기", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "보관함 내보내기", exact: true });
  await dialog.getByRole("radio", { name: /카테고리 그룹 공유/ }).check();
  await dialog
    .getByRole("checkbox", { name: "주말의 이야기", exact: true })
    .check();
  const groupDownloaded = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "JSON 내보내기" }).click();
  const groupDownload = await groupDownloaded;
  const groupPath = await groupDownload.path();
  const groupBackup = JSON.parse(await readFile(groupPath!, "utf8"));
  expect(groupBackup.scope).toBe("group");
  expect(groupBackup.data.bookmarks[0].notes).toBe("");
  expect(groupBackup.data.bookmarks[0].favorite).toBe(false);
  await expect(dialog).toBeHidden();

  await page.getByLabel("백업 파일 선택").setInputFiles(path!);
  dialog = page.getByRole("dialog", {
    name: "백업을 가져올까요?",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "병합하여 가져오기" }).click();
  await expect(dialog).toBeHidden();
  expect(
    (await snapshot()).bookmarks.filter(
      (b: { deletedAt?: number }) => b.deletedAt === undefined,
    ),
  ).toHaveLength(1);

  // Deleting a category must preserve its title and move it into the uncategorized view.
  await page
    .getByRole("button", { name: "주말의 이야기", exact: true })
    .click();
  await page
    .getByRole("button", { name: "현재 카테고리 편집", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "카테고리 편집", exact: true });
  await dialog
    .getByRole("button", { name: "이 카테고리 삭제", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "카테고리를 삭제할까요?",
    exact: true,
  });
  await dialog
    .getByRole("button", { name: "카테고리 삭제", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "미분류", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "프리렌의 여행", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "프리렌의 여행", exact: true }),
  ).toBeVisible();
});

test("invalid imports and invalid manual title URLs leave saved data unchanged", async () => {
  const before = await snapshot();
  await page.getByLabel("백업 파일 선택").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"format":"other-app","schemaVersion":1}'),
  });
  await expect(page.getByRole("alert")).toBeVisible();
  expect((await snapshot()).bookmarks).toEqual(before.bookmarks);

  await page.getByRole("button", { name: "작품 추가", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "작품 직접 추가",
    exact: true,
  });
  await dialog
    .getByLabel("작품 제목", { exact: true })
    .fill("검색 화면은 작품이 아니에요");
  await dialog
    .getByLabel("작품 상세 주소")
    .fill("https://laftel.net/search?keyword=test");
  await dialog.getByRole("button", { name: "보관함에 담기" }).click();
  await expect(dialog.getByRole("alert")).toContainText("작품 상세 주소");
  expect((await snapshot()).bookmarks).toEqual(before.bookmarks);
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
});
