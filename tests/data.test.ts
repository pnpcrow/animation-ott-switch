import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { createRepository } from "../src/core/repository";
import { mergeSnapshots, parseBackup } from "../src/core/backup";
import type { BackupEnvelope, PageTitle } from "../src/core/types";

const repositories: ReturnType<typeof createRepository>[] = [];
function repo() {
  const value = createRepository(`test-${crypto.randomUUID()}`);
  repositories.push(value);
  return value;
}
const page = (id = "12345"): PageTitle => ({
  provider: "laftel",
  title: "마녀의 여행",
  description: "함께 여행을 떠나는 이야기",
  imageUrl: "https://images.example.com/poster.jpg",
  url: `https://laftel.net/item/${id}/test`,
  aliases: [],
  year: 2020,
});
afterEach(async () => {
  await Promise.all(repositories.splice(0).map((r) => r.close()));
});

describe("local repository", () => {
  it("starts with Korean categories, no assumed subscription, and persists across reopen", async () => {
    const db = repo();
    const initial = await db.snapshot();
    expect(initial.categories.map((c) => c.name).sort()).toEqual(
      ["보는 중", "볼 예정", "완주"].sort(),
    );
    expect(initial.settings.subscribedProviders).toEqual([]);
    const saved = await db.saveBookmark({
      page: page(),
      categoryIds: ["watchlist"],
    });
    await db.close();
    expect((await db.snapshot()).bookmarks[0].id).toBe(saved.id);
  });

  it("deduplicates provider IDs while preserving customized metadata", async () => {
    const db = repo();
    const saved = await db.saveBookmark({
      page: page(),
      categoryIds: ["watchlist"],
    });
    await db.updateBookmark(saved.id, {
      description: "내가 작성한 소개",
      imageUrl: "https://example.com/custom.jpg",
      title: "내 제목",
    });
    const again = await db.saveBookmark({
      page: {
        ...page(),
        url: "https://laftel.net/item/12345/another-slug?tracking=1#x",
      },
      categoryIds: ["watching"],
    });
    expect(again.id).toBe(saved.id);
    expect(again.description).toBe("내가 작성한 소개");
    expect(again.title).toBe("내 제목");
    expect(again.categoryIds).toEqual(["watching"]);
    expect((await db.snapshot()).bookmarks).toHaveLength(1);
  });

  it("does not merge different provider IDs with the same title", async () => {
    const db = repo();
    await Promise.all(
      ["12345", "12346"].map((id) =>
        db.saveBookmark({ page: page(id), categoryIds: [] }),
      ),
    );
    expect((await db.snapshot()).bookmarks).toHaveLength(2);
  });

  it("clears a year through a JSON-serialized null patch and preserves it when omitted", async () => {
    const db = repo();
    const saved = await db.saveBookmark({ page: page(), categoryIds: [] });
    expect(saved.year).toBe(2020);
    expect(
      (await db.updateBookmark(saved.id, { notes: "연도 유지" })).year,
    ).toBe(2020);
    const transportPatch = JSON.parse(JSON.stringify({ year: null }));
    const cleared = await db.updateBookmark(saved.id, transportPatch);
    expect(cleared.year).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(cleared, "year")).toBe(false);
    await db.close();
    expect((await db.snapshot()).bookmarks[0].year).toBeUndefined();
  });

  it("serializes concurrent writes without lost records and advances revision time", async () => {
    const db = repo();
    const saved = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        db.saveBookmark({ page: page(String(20000 + i)), categoryIds: [] }),
      ),
    );
    expect((await db.snapshot()).bookmarks).toHaveLength(20);
    expect(new Set(saved.map((b) => b.updatedAt)).size).toBe(20);
    const old = saved[0].updatedAt;
    expect(
      (await db.updateBookmark(saved[0].id, { notes: "수정" })).updatedAt,
    ).toBeGreaterThan(old);
  });

  it("deletes categories without deleting their titles; stale backup cannot restore the category", async () => {
    const db = repo();
    await db.saveBookmark({ page: page(), categoryIds: ["watchlist"] });
    const old = await db.exportBackup();
    await db.deleteCategory("watchlist");
    await db.importBackup(old);
    const state = await db.snapshot();
    expect(
      state.categories.find((c) => c.id === "watchlist")?.deletedAt,
    ).toBeDefined();
    expect(state.bookmarks[0].deletedAt).toBeUndefined();
    const updated = await db.updateBookmark(state.bookmarks[0].id, {
      categoryIds: ["watchlist"],
      notes: "계속 편집 가능",
    });
    expect(updated.categoryIds).toEqual([]);
    expect(updated.notes).toBe("계속 편집 가능");
    await expect(
      db.updateBookmark(updated.id, { categoryIds: ["unknown-category"] }),
    ).rejects.toThrow("카테고리");
  });

  it("preserves deletion tombstones when importing an older full backup", async () => {
    const db = repo();
    const saved = await db.saveBookmark({ page: page(), categoryIds: [] });
    const old = await db.exportBackup();
    await db.deleteBookmark(saved.id);
    await db.importBackup(old);
    expect((await db.snapshot()).bookmarks[0].deletedAt).toBeDefined();
    const resurrected = await db.saveBookmark({
      page: page(),
      categoryIds: [],
    });
    expect(resurrected.id).toBe(saved.id);
    expect(resurrected.deletedAt).toBeUndefined();
  });

  it("rejects malformed imports atomically", async () => {
    const db = repo();
    const saved = await db.saveBookmark({ page: page(), categoryIds: [] });
    const backup = await db.exportBackup();
    backup.data.bookmarks.push({
      ...saved,
      id: "bad",
      imageUrl: "javascript:alert(1)",
    });
    const before = await db.snapshot();
    await expect(db.importBackup(backup)).rejects.toThrow("HTTPS");
    expect(await db.snapshot()).toEqual(before);
  });

  it("merges an independently saved same-provider title under the local ID", async () => {
    const a = repo();
    const b = repo();
    const local = await a.saveBookmark({ page: page(), categoryIds: [] });
    const remote = await b.saveBookmark({
      page: page(),
      categoryIds: ["watching"],
    });
    await b.updateBookmark(remote.id, { description: "더 최근의 소개" });
    await a.importBackup(await b.exportBackup());
    const result = (await a.snapshot()).bookmarks;
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(local.id);
    expect(result[0].description).toBe("더 최근의 소개");
  });

  it("makes the next local edit newer than an imported future timestamp", async () => {
    const db = repo();
    const saved = await db.saveBookmark({ page: page(), categoryIds: [] });
    const backup = await db.exportBackup();
    backup.data.bookmarks[0].updatedAt = Date.now() + 60_000;
    await db.importBackup(backup);
    const edited = await db.updateBookmark(saved.id, {
      notes: "가져온 뒤 수정",
    });
    expect(edited.updatedAt).toBeGreaterThan(
      backup.data.bookmarks[0].updatedAt,
    );
    await db.importBackup(backup);
    expect((await db.snapshot()).bookmarks[0].notes).toBe("가져온 뒤 수정");
  });

  it("rejects duplicate manual links without partial changes", async () => {
    const db = repo();
    const a = await db.saveBookmark({ page: page("11111"), categoryIds: [] });
    const b = await db.saveBookmark({ page: page("22222"), categoryIds: [] });
    await expect(
      db.updateBookmark(b.id, { links: a.links, notes: "실패할 수정" }),
    ).rejects.toThrow("이미");
    expect(
      (await db.snapshot()).bookmarks.find((record) => record.id === b.id)
        ?.notes,
    ).toBe("");
  });

  it("saves discovered links atomically and rejects conflicts without saving a new title", async () => {
    const db = repo();
    const netflix = {
      provider: "netflix" as const,
      url: "https://www.netflix.com/title/80123456",
      title: "마녀의 여행",
      verifiedAt: Date.now(),
      source: "search" as const,
    };
    const first = await db.saveBookmark({
      page: page("11111"),
      categoryIds: ["watchlist"],
      links: { netflix },
    });
    expect(first.links.netflix).toEqual(netflix);
    const before = await db.snapshot();
    await expect(
      db.saveBookmark({
        page: page("22222"),
        categoryIds: [],
        links: { netflix },
      }),
    ).rejects.toThrow("이미");
    expect(await db.snapshot()).toEqual(before);
    await expect(
      db.saveBookmark({
        page: page("33333"),
        categoryIds: [],
        links: {
          netflix: { ...netflix, url: "https://evil.example/title/80123456" },
        },
      }),
    ).rejects.toThrow("공식");
    expect(await db.snapshot()).toEqual(before);
  });

  it("group export shares only selected live records and strips personal fields", async () => {
    const db = repo();
    const shared = await db.saveBookmark({
      page: page(),
      categoryIds: ["watchlist", "watching"],
    });
    await db.updateBookmark(shared.id, {
      notes: "비공개 메모",
      favorite: true,
    });
    await db.saveBookmark({ page: page("99999"), categoryIds: ["completed"] });
    await db.updateSettings({ subscribedProviders: ["netflix"] });
    const group = await db.exportBackup(["watchlist"]);
    expect(group.scope).toBe("group");
    expect(group.data.bookmarks).toHaveLength(1);
    expect(group.data.bookmarks[0].categoryIds).toEqual(["watchlist"]);
    expect(group.data.bookmarks[0].notes).toBe("");
    expect(group.data.bookmarks[0].favorite).toBe(false);
    expect(group.data.settings.subscribedProviders).toEqual([]);
    expect(group.data.categories.map((c) => c.id)).toEqual(["watchlist"]);
    expect(parseBackup(JSON.stringify(group))).toEqual(group);
  });

  it("group import preserves personal fields/settings and is idempotent", async () => {
    const db = repo();
    const saved = await db.saveBookmark({
      page: page(),
      categoryIds: ["watching"],
    });
    await db.updateBookmark(saved.id, { notes: "내 메모", favorite: true });
    await db.updateSettings({
      subscribedProviders: ["apple"],
      openInNewTab: false,
    });
    const group = await db.exportBackup(["watching"]);
    group.data.bookmarks[0].description = "공유 소개";
    group.data.bookmarks[0].updatedAt += 10;
    group.data.bookmarks[0].categoryIds = ["watchlist"];
    group.data.categories = (await db.snapshot()).categories.filter(
      (c) => c.id === "watchlist",
    );
    await db.importBackup(group);
    const first = await db.snapshot();
    expect(first.bookmarks[0].categoryIds.sort()).toEqual([
      "watching",
      "watchlist",
    ]);
    expect(first.bookmarks[0].notes).toBe("내 메모");
    expect(first.bookmarks[0].favorite).toBe(true);
    expect(first.bookmarks[0].description).toBe("공유 소개");
    expect(first.settings.subscribedProviders).toEqual(["apple"]);
    expect(first.settings.openInNewTab).toBe(false);
    await db.importBackup(group);
    expect(await db.snapshot()).toEqual(first);
  });
});

describe("backup validation and convergence", () => {
  it("merges commutatively, associatively and idempotently, retaining newest edits", async () => {
    const db = repo();
    await db.saveBookmark({ page: page(), categoryIds: [] });
    const a = await db.snapshot();
    const b = structuredClone(a);
    const c = structuredClone(a);
    b.bookmarks[0].description = "기기 B";
    b.bookmarks[0].deviceId = "b";
    b.bookmarks[0].updatedAt += 1;
    c.bookmarks[0].description = "기기 C";
    c.bookmarks[0].deviceId = "c";
    c.bookmarks[0].updatedAt += 1;
    expect(mergeSnapshots(a, b)).toEqual(mergeSnapshots(b, a));
    expect(mergeSnapshots(a, a)).toEqual(a);
    expect(mergeSnapshots(mergeSnapshots(a, b), c)).toEqual(
      mergeSnapshots(a, mergeSnapshots(b, c)),
    );
    expect(mergeSnapshots(b, c).bookmarks[0].description).toBe("기기 C");
  });

  it("gives a simultaneous deletion precedence and uses deterministic final tie-breaks", async () => {
    const db = repo();
    await db.saveBookmark({ page: page(), categoryIds: [] });
    const a = await db.snapshot();
    const b = structuredClone(a);
    b.bookmarks[0].deletedAt = b.bookmarks[0].updatedAt;
    expect(mergeSnapshots(a, b).bookmarks[0].deletedAt).toBeDefined();
    delete b.bookmarks[0].deletedAt;
    b.bookmarks[0].notes = "same clock/device different content";
    expect(mergeSnapshots(a, b)).toEqual(mergeSnapshots(b, a));
  });

  it("rejects unsupported versions, duplicate IDs, untrusted hosts, search URLs and invalid timestamps", async () => {
    const db = repo();
    await db.saveBookmark({ page: page(), categoryIds: [] });
    const good = await db.exportBackup();
    const changed = (change: (copy: BackupEnvelope) => void) => {
      const copy = structuredClone(good);
      change(copy);
      return copy;
    };
    expect(() => parseBackup({ ...good, schemaVersion: 2 })).toThrow();
    expect(() =>
      parseBackup(changed((b) => b.data.bookmarks.push(b.data.bookmarks[0]))),
    ).toThrow("중복");
    expect(() =>
      parseBackup(
        changed((b) => {
          b.data.bookmarks[0].links.laftel!.url =
            "https://laftel.net.evil.test/item/12345";
        }),
      ),
    ).toThrow("공식");
    expect(() =>
      parseBackup(
        changed((b) => {
          b.data.bookmarks[0].links.laftel!.url =
            "https://laftel.net/search?keyword=test";
        }),
      ),
    ).toThrow("공식");
    expect(() =>
      parseBackup(
        changed((b) => {
          b.data.bookmarks[0].updatedAt = Number.MAX_SAFE_INTEGER;
        }),
      ),
    ).toThrow("미래");
    expect(() =>
      parseBackup(
        changed((b) => {
          b.data.bookmarks[0].imageUrl =
            "https://user:password@example.com/image.jpg";
        }),
      ),
    ).toThrow("HTTPS");
  });
});
