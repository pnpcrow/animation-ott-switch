import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { deleteDB, openDB } from "idb";
import { createRepository } from "../src/core/repository";

// These persisted names and records describe the v0.1.5 disk contract. Do not
// derive them from the current repository implementation: a renamed database,
// key or store must fail this compatibility test instead of silently migrating
// the fixture to a new, empty library.
const legacyDatabaseName = "ott-switch-library";
const legacyDeviceId = "v015-device-stable";
const legacyTime = 1_700_000_100_000;
const legacyBookmark = {
  id: "v015-bookmark-witch",
  title: "내가 정리한 마녀의 여행",
  aliases: ["마녀의 여행", "Wandering Witch"],
  description: "직접 작성해 둔 소개를 업데이트 후에도 보존한다.",
  imageUrl: "https://example.com/my-witch-poster.jpg",
  year: 2020,
  categoryIds: ["watchlist", "v015-category-personal"],
  links: {
    laftel: {
      provider: "laftel",
      url: "https://laftel.net/item/12345",
      title: "마녀의 여행",
      verifiedAt: legacyTime,
      source: "page",
    },
  },
  favorite: true,
  notes: "남겨 둔 개인 메모",
  createdAt: legacyTime - 1000,
  updatedAt: legacyTime,
  deviceId: legacyDeviceId,
};
const legacyCategories = [
  ["watchlist", "이름을 바꾼 볼 예정"],
  ["watching", "보는 중"],
  ["completed", "완주"],
  ["v015-category-personal", "내 여행 작품"],
].map(([id, name]) => ({
  id,
  name,
  color: "#818cf8",
  createdAt: legacyTime - 2000,
  updatedAt: legacyTime,
  deviceId: legacyDeviceId,
}));
const legacyDeletedCategory = {
  id: "v015-category-deleted",
  name: "삭제된 분류",
  color: "#fbbf24",
  createdAt: legacyTime - 2000,
  updatedAt: legacyTime,
  deletedAt: legacyTime,
  deviceId: legacyDeviceId,
};
const legacyDeletedBookmark = {
  ...legacyBookmark,
  id: "v015-bookmark-deleted",
  title: "삭제된 작품",
  categoryIds: [legacyDeletedCategory.id],
  links: {},
  deletedAt: legacyTime,
};
const legacySettings = {
  id: "settings",
  subscribedProviders: ["laftel", "netflix"],
  region: "KR",
  openInNewTab: false,
  updatedAt: legacyTime,
  deviceId: legacyDeviceId,
};
const legacySnapshot = {
  schemaVersion: 1,
  bookmarks: [legacyBookmark, legacyDeletedBookmark].sort((a, b) =>
    a.id.localeCompare(b.id),
  ),
  categories: [...legacyCategories, legacyDeletedCategory].sort((a, b) =>
    a.id.localeCompare(b.id),
  ),
  settings: legacySettings,
};

const repositories: ReturnType<typeof createRepository>[] = [];
const databases = new Set<string>();
function trackRepository(name?: string) {
  const repository = createRepository(name);
  repositories.push(repository);
  databases.add(name ?? legacyDatabaseName);
  return repository;
}

async function seedV015Library() {
  databases.add(legacyDatabaseName);
  const connection = await openDB(legacyDatabaseName, 1, {
    upgrade(db) {
      db.createObjectStore("bookmarks", { keyPath: "id" });
      db.createObjectStore("categories", { keyPath: "id" });
      db.createObjectStore("settings", { keyPath: "id" });
      db.createObjectStore("meta");
    },
  });
  // A clock ahead of wall time detects accidental clock-key replacement, while
  // old record revisions independently detect accidental device reinitializing.
  const storedClock = Date.now() + 60_000;
  try {
    const tx = connection.transaction(
      ["bookmarks", "categories", "settings", "meta"],
      "readwrite",
    );
    for (const bookmark of legacySnapshot.bookmarks)
      await tx.objectStore("bookmarks").put(structuredClone(bookmark));
    for (const category of legacySnapshot.categories)
      await tx.objectStore("categories").put(structuredClone(category));
    await tx.objectStore("settings").put(structuredClone(legacySettings));
    await tx.objectStore("meta").put(legacyDeviceId, "deviceId");
    await tx.objectStore("meta").put(storedClock, "clock");
    await tx.done;
  } finally {
    connection.close();
  }
  return storedClock;
}

afterEach(async () => {
  await Promise.all(
    repositories.splice(0).map((repository) => repository.close()),
  );
  await Promise.all([...databases].map((name) => deleteDB(name)));
  databases.clear();
});

describe("v0.1.5 persisted identity compatibility", () => {
  it("opens the existing default library without changing records, keys or revision identity", async () => {
    const storedClock = await seedV015Library();
    const upgraded = trackRepository();
    expect(await upgraded.snapshot()).toEqual(legacySnapshot);
    await upgraded.close();

    const restarted = trackRepository();
    expect(await restarted.snapshot()).toEqual(legacySnapshot);
    const edited = await restarted.updateBookmark(legacyBookmark.id, {
      notes: "업데이트 후 추가한 메모",
    });
    expect(edited).toMatchObject({
      ...legacyBookmark,
      notes: "업데이트 후 추가한 메모",
      updatedAt: storedClock + 1,
    });
    await restarted.close();
    const connection = await openDB(legacyDatabaseName);
    try {
      expect(connection.version).toBe(1);
      expect([...connection.objectStoreNames]).toEqual([
        "bookmarks",
        "categories",
        "meta",
        "settings",
      ]);
      expect(await connection.get("meta", "deviceId")).toBe(legacyDeviceId);
      expect(await connection.get("meta", "clock")).toBe(storedClock + 1);
      expect(await connection.get("bookmarks", legacyBookmark.id)).toEqual(
        edited,
      );
      expect(
        await connection.get("bookmarks", legacyDeletedBookmark.id),
      ).toEqual(legacyDeletedBookmark);
      expect(await connection.get("settings", "settings")).toEqual(
        legacySettings,
      );
    } finally {
      connection.close();
    }
  });

  it("moves a v0.1.5 full backup to a new installation without renumbering records or losing tombstones", async () => {
    await seedV015Library();
    const existing = trackRepository();
    const exported = await existing.exportBackup();
    expect(exported).toMatchObject({
      format: "ott-switch",
      schemaVersion: 1,
      scope: "full",
      data: legacySnapshot,
    });

    // A separate database models the data import contract for a new extension
    // origin. It does not claim that Chrome shares IndexedDB across origins.
    const newDatabaseName = `identity-new-install-${crypto.randomUUID()}`;
    const fresh = trackRepository(newDatabaseName);
    const initial = await fresh.snapshot();
    expect(initial.categories.map((category) => category.id).sort()).toEqual([
      "completed",
      "watching",
      "watchlist",
    ]);
    expect(initial.settings.id).toBe("settings");
    const raw = await openDB(newDatabaseName);
    let newDeviceId: unknown;
    try {
      newDeviceId = await raw.get("meta", "deviceId");
    } finally {
      raw.close();
    }
    expect(typeof newDeviceId).toBe("string");
    expect(newDeviceId).not.toBe(legacyDeviceId);

    await fresh.importBackup(JSON.stringify(exported));
    await fresh.close();
    expect(await fresh.snapshot()).toEqual(legacySnapshot);
    expect((await fresh.exportBackup()).data).toEqual(legacySnapshot);
    const renamed = await fresh.saveCategory(
      "다시 이름을 바꾼 개인 분류",
      "#34d399",
      "v015-category-personal",
    );
    expect(renamed.id).toBe("v015-category-personal");
    expect(renamed.createdAt).toBe(legacyTime - 2000);
    expect(renamed.deviceId).toBe(newDeviceId);
    expect((await fresh.snapshot()).bookmarks).toEqual(
      legacySnapshot.bookmarks,
    );
  });
});
