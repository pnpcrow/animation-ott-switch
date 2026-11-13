import {
  test,
  expect,
  chromium,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { removeTestProfile } from "./profile";

// The Web Store item created from v0.1.5 owns this identity. Version and install
// directory may change, but this value must not silently follow those changes.
const expectedId = "cmaijknliglhgokkmijggladebokgafl";
const expectedVersion = JSON.parse(
  await readFile(resolve("package.json"), "utf8"),
).version as string;
const temporaryDirectories: string[] = [];
let activeContext: BrowserContext | undefined;

async function temporaryDirectory(kind: string) {
  const path = await mkdtemp(join(tmpdir(), `ott-switch-identity-${kind}-`));
  temporaryDirectories.push(path);
  return path;
}

async function installation(kind: string, version?: string) {
  const directory = await temporaryDirectory(kind);
  await cp(resolve("dist"), directory, { recursive: true });
  if (version) {
    const path = join(directory, "manifest.json");
    const manifest = JSON.parse(await readFile(path, "utf8"));
    manifest.version = version;
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return directory;
}

async function launch(
  profile: string,
  directory: string,
  version = expectedVersion,
) {
  activeContext = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${directory}`,
      `--load-extension=${directory}`,
    ],
  });
  await activeContext.route(/^https?:\/\//, (route) => route.abort());
  const worker =
    activeContext.serviceWorkers()[0] ??
    (await activeContext.waitForEvent("serviceworker"));
  await worker.evaluate(() => {
    globalThis.fetch = async () =>
      new Response("Offline identity fixture", { status: 403 });
  });
  expect(new URL(worker.url()).host).toBe(expectedId);
  expect(
    await worker.evaluate(() => ({
      id: chrome.runtime.id,
      version: chrome.runtime.getManifest().version,
    })),
  ).toEqual({ id: expectedId, version });
  const page = await activeContext.newPage();
  await page.goto(`chrome-extension://${expectedId}/library.html`);
  await expect(page.locator("h1")).toContainText("모든 작품");
  return page;
}

async function rpc(page: Page, action: string, args: unknown[] = []) {
  const response = await page.evaluate(
    ({ action, args }) =>
      chrome.runtime.sendMessage({ channel: "ott-switch", action, args }),
    { action, args },
  );
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

async function closeContext() {
  await activeContext?.close();
  activeContext = undefined;
}

test.afterEach(async () => {
  await closeContext();
  // removeTestProfile checks the resolved tmpdir parent and ott-switch- prefix
  // before recursively deleting either an isolated profile or install copy.
  for (const directory of temporaryDirectories.splice(0)) {
    await removeTestProfile(directory);
  }
});

test("uses the store ID in different unpacked folders and fresh profiles", async () => {
  const firstInstall = await installation("first-location");
  const secondInstall = await installation("other-location");
  expect(firstInstall).not.toBe(secondInstall);
  const first = await launch(
    await temporaryDirectory("profile-a"),
    firstInstall,
  );
  expect((await rpc(first, "snapshot")).bookmarks).toEqual([]);
  await closeContext();
  const second = await launch(
    await temporaryDirectory("profile-b"),
    secondInstall,
  );
  expect((await rpc(second, "snapshot")).bookmarks).toEqual([]);
});

test("preserves stored identities when a same-key version update loads from another folder", async () => {
  // This is a controlled same-key update, not an automatic migration from the
  // original unkeyed v0.1.5 installation or a claim to execute old release code.
  const oldInstall = await installation("before-update", "0.0.1");
  const newInstall = await installation("after-update");
  const profile = await temporaryDirectory("update-profile");
  const oldPage = await launch(profile, oldInstall, "0.0.1");
  const category = await rpc(oldPage, "saveCategory", [
    "고정 ID 확인",
    "#e9b86b",
  ]);
  const bookmark = await rpc(oldPage, "saveBookmark", [
    {
      page: {
        provider: "laftel",
        url: "https://laftel.net/item/41666",
        title: "장송의 프리렌",
        description: "같은 확장 ID의 업데이트 후에도 남아야 하는 소개",
        imageUrl: "",
        aliases: ["Frieren"],
      },
      categoryIds: [category.id],
    },
  ]);
  await rpc(oldPage, "updateBookmark", [
    bookmark.id,
    {
      favorite: true,
      notes: "기존 북마크 ID와 분류를 유지합니다.",
    },
  ]);
  await rpc(oldPage, "updateSettings", [
    { openInNewTab: false, subscribedProviders: [] },
  ]);
  const before = await rpc(oldPage, "snapshot");
  const beforeBackup = await rpc(oldPage, "exportBackup");
  await closeContext();

  const currentPage = await launch(profile, newInstall);
  const after = await rpc(currentPage, "snapshot");
  expect(after).toEqual(before);
  expect(after.bookmarks).toHaveLength(1);
  expect(after.bookmarks[0]).toMatchObject({
    id: bookmark.id,
    categoryIds: [category.id],
    favorite: true,
    notes: "기존 북마크 ID와 분류를 유지합니다.",
  });
  const afterBackup = await rpc(currentPage, "exportBackup");
  expect(afterBackup.format).toBe(beforeBackup.format);
  expect(afterBackup.data).toEqual(beforeBackup.data);
  await expect(currentPage.getByText("장송의 프리렌").first()).toBeVisible();
});
