import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  canonicalizeProviderUrl,
  providerTitleId,
} from "../providers/identity";
import {
  latest,
  mergeSnapshots,
  neutralSettings,
  parseBackup,
  parseBookmark,
  parseCategory,
  parseSettings,
} from "./backup";
import type {
  BackupEnvelope,
  Bookmark,
  BookmarkPatch,
  Category,
  LibrarySnapshot,
  ProviderId,
  SaveBookmarkInput,
  Settings,
} from "./types";

interface LibraryDB extends DBSchema {
  bookmarks: { key: string; value: Bookmark };
  categories: { key: string; value: Category };
  settings: { key: string; value: Settings };
  meta: { key: string; value: string | number };
}
const STORES = ["bookmarks", "categories", "settings", "meta"] as const;
type MutableState = LibrarySnapshot & { clock: number; deviceId: string };
export type SettingsPatch = Partial<
  Pick<Settings, "subscribedProviders" | "region" | "openInNewTab">
>;

function key(provider: ProviderId, url: string): string {
  return `${provider}:${providerTitleId(url) ?? canonicalizeProviderUrl(url) ?? url}`;
}
function linkKeys(bookmark: Bookmark): Set<string> {
  return new Set(
    Object.values(bookmark.links)
      .filter((link) => link !== undefined)
      .map((link) => key(link.provider, link.url)),
  );
}
function sharesLink(a: Bookmark, b: Bookmark): boolean {
  const keys = linkKeys(a);
  return Object.values(b.links).some(
    (link) => link && keys.has(key(link.provider, link.url)),
  );
}
function stamp(state: MutableState): { updatedAt: number; deviceId: string } {
  state.clock = Math.max(Date.now(), state.clock + 1);
  return { updatedAt: state.clock, deviceId: state.deviceId };
}
function cleanCategoryIds(state: LibrarySnapshot, ids: string[]): string[] {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string"))
    throw new Error("카테고리 선택이 올바르지 않습니다.");
  const known = new Set(state.categories.map((c) => c.id));
  const available = new Set(
    state.categories.filter((c) => c.deletedAt === undefined).map((c) => c.id),
  );
  if (ids.some((id) => !known.has(id)))
    throw new Error("존재하지 않는 카테고리입니다.");
  // An editor can still hold membership IDs from before another tab deleted a category.
  // Drop known tombstones so editing a title never resurrects or becomes blocked by them.
  return [...new Set(ids.filter((id) => available.has(id)))];
}
function ensureUniqueLinks(state: LibrarySnapshot, record: Bookmark): void {
  if (
    state.bookmarks.some(
      (other) =>
        other.id !== record.id &&
        other.deletedAt === undefined &&
        sharesLink(record, other),
    )
  ) {
    throw new Error(
      "이 OTT 작품은 이미 다른 북마크에 연결되어 있습니다. 기존 북마크를 편집해 주세요.",
    );
  }
}
function maxRevision(state: LibrarySnapshot): number {
  return Math.max(
    0,
    state.settings.updatedAt,
    ...state.bookmarks.map((b) => b.updatedAt),
    ...state.categories.map((c) => c.updatedAt),
  );
}

export function createRepository(name = "ott-switch-library") {
  let database: Promise<IDBPDatabase<LibraryDB>> | undefined;
  async function db(): Promise<IDBPDatabase<LibraryDB>> {
    database ??= openDB<LibraryDB>(name, 1, {
      upgrade(connection) {
        connection.createObjectStore("bookmarks", { keyPath: "id" });
        connection.createObjectStore("categories", { keyPath: "id" });
        connection.createObjectStore("settings", { keyPath: "id" });
        connection.createObjectStore("meta");
      },
      blocked() {
        console.warn(
          "OTT Switch 데이터베이스를 사용하는 이전 확장 탭을 닫아 주세요.",
        );
      },
      blocking() {
        void database?.then((connection) => connection.close());
        database = undefined;
      },
    });
    const connection = await database;
    // Read-write initialization is serialized across pages/service-worker restarts.
    const tx = connection.transaction(STORES, "readwrite");
    if (!(await tx.objectStore("meta").get("deviceId"))) {
      const deviceId = crypto.randomUUID();
      await tx.objectStore("meta").put(deviceId, "deviceId");
      await tx.objectStore("meta").put(0, "clock");
      for (const [id, categoryName, color] of [
        ["watchlist", "볼 예정", "#818cf8"],
        ["watching", "보는 중", "#34d399"],
        ["completed", "완주", "#fbbf24"],
      ]) {
        await tx
          .objectStore("categories")
          .put({
            id,
            name: categoryName,
            color,
            createdAt: 0,
            updatedAt: 0,
            deviceId: "defaults",
          });
      }
      await tx
        .objectStore("settings")
        .put({ ...neutralSettings(), deviceId: "defaults" });
    }
    await tx.done;
    return connection;
  }

  async function snapshot(): Promise<LibrarySnapshot> {
    const connection = await db();
    const tx = connection.transaction(
      ["bookmarks", "categories", "settings"],
      "readonly",
    );
    const [bookmarks, categories, settings] = await Promise.all([
      tx.objectStore("bookmarks").getAll(),
      tx.objectStore("categories").getAll(),
      tx.objectStore("settings").get("settings"),
    ]);
    await tx.done;
    if (!settings) throw new Error("보관함 설정을 읽지 못했습니다.");
    return { schemaVersion: 1, bookmarks, categories, settings };
  }

  async function mutate<T>(operation: (state: MutableState) => T): Promise<T> {
    const connection = await db();
    const tx = connection.transaction(STORES, "readwrite");
    try {
      const [bookmarks, categories, settings, deviceId, storedClock] =
        await Promise.all([
          tx.objectStore("bookmarks").getAll(),
          tx.objectStore("categories").getAll(),
          tx.objectStore("settings").get("settings"),
          tx.objectStore("meta").get("deviceId"),
          tx.objectStore("meta").get("clock"),
        ]);
      if (!settings || typeof deviceId !== "string")
        throw new Error("보관함 초기화에 실패했습니다.");
      const state: MutableState = {
        schemaVersion: 1,
        bookmarks,
        categories,
        settings,
        deviceId,
        clock: Math.max(
          Number(storedClock) || 0,
          maxRevision({ schemaVersion: 1, bookmarks, categories, settings }),
        ),
      };
      const result = operation(state);
      await Promise.all([
        ...state.bookmarks.map((record) =>
          tx.objectStore("bookmarks").put(record),
        ),
        ...state.categories.map((record) =>
          tx.objectStore("categories").put(record),
        ),
        tx.objectStore("settings").put(state.settings),
        tx
          .objectStore("meta")
          .put(Math.max(state.clock, maxRevision(state)), "clock"),
      ]);
      await tx.done;
      return result;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* The transaction may already have aborted. */
      }
      await tx.done.catch(() => undefined);
      throw error;
    }
  }

  async function saveBookmark(input: SaveBookmarkInput): Promise<Bookmark> {
    if (!input || !input.page) throw new Error("저장할 작품 정보가 없습니다.");
    return mutate((state) => {
      const { page } = input;
      const url = canonicalizeProviderUrl(page.url);
      if (!url)
        throw new Error("지원하는 OTT의 작품 페이지에서 저장해 주세요.");
      const identity = key(page.provider, url);
      const existing = state.bookmarks.find((b) =>
        Object.values(b.links).some(
          (link) => link && key(link.provider, link.url) === identity,
        ),
      );
      const revision = stamp(state);
      const link = {
        provider: page.provider,
        url,
        title: page.title,
        verifiedAt: revision.updatedAt,
        source: "page" as const,
      };
      const candidate = parseBookmark({
        id: existing?.id ?? crypto.randomUUID(),
        title: existing?.title ?? page.title,
        aliases: [
          ...new Set([
            ...(existing?.aliases ?? []),
            ...page.aliases,
            ...(existing && existing.title !== page.title ? [page.title] : []),
          ]),
        ].slice(0, 30),
        description: existing?.description ?? page.description,
        imageUrl: existing?.imageUrl ?? page.imageUrl,
        year: existing?.year ?? page.year,
        categoryIds: cleanCategoryIds(state, input.categoryIds),
        links: { ...existing?.links, ...input.links, [page.provider]: link },
        favorite: existing?.favorite ?? false,
        notes: existing?.notes ?? "",
        createdAt: existing?.createdAt ?? revision.updatedAt,
        ...revision,
      });
      ensureUniqueLinks(state, candidate);
      state.bookmarks = [
        ...state.bookmarks.filter((b) => b.id !== candidate.id),
        candidate,
      ];
      return candidate;
    });
  }

  async function updateBookmark(
    id: string,
    patch: BookmarkPatch,
  ): Promise<Bookmark> {
    return mutate((state) => {
      const existing = state.bookmarks.find(
        (b) => b.id === id && b.deletedAt === undefined,
      );
      if (!existing) throw new Error("작품을 찾을 수 없습니다.");
      const allowed: BookmarkPatch = {};
      for (const property of [
        "title",
        "aliases",
        "description",
        "imageUrl",
        "year",
        "categoryIds",
        "links",
        "favorite",
        "notes",
      ] as const) {
        if (Object.prototype.hasOwnProperty.call(patch, property))
          Object.assign(allowed, { [property]: patch[property] });
      }
      allowed.categoryIds = cleanCategoryIds(
        state,
        allowed.categoryIds ?? existing.categoryIds,
      );
      // Chrome messaging uses JSON serialization: null is the explicit clear operation.
      if (allowed.year === null) allowed.year = undefined;
      const record = parseBookmark({
        ...existing,
        ...allowed,
        ...stamp(state),
      });
      ensureUniqueLinks(state, record);
      state.bookmarks = state.bookmarks.map((b) => (b.id === id ? record : b));
      return record;
    });
  }

  async function deleteBookmark(id: string): Promise<void> {
    return mutate((state) => {
      const record = state.bookmarks.find(
        (b) => b.id === id && b.deletedAt === undefined,
      );
      if (!record) return;
      Object.assign(record, stamp(state));
      record.deletedAt = record.updatedAt;
    });
  }

  async function clearSearchResults(): Promise<{
    links: number;
    bookmarks: number;
  }> {
    return mutate((state) => {
      let links = 0,
        bookmarks = 0;
      for (const bookmark of state.bookmarks) {
        const automatic = Object.entries(bookmark.links).filter(
          ([, link]) => link?.source === "search",
        );
        if (!automatic.length) continue;
        for (const [provider] of automatic)
          delete bookmark.links[provider as ProviderId];
        links += automatic.length;
        bookmarks++;
        Object.assign(bookmark, stamp(state));
      }
      return { links, bookmarks };
    });
  }

  async function saveCategory(
    name: string,
    color = "#818cf8",
    id?: string,
  ): Promise<Category> {
    return mutate((state) => {
      const existing = id
        ? state.categories.find((c) => c.id === id && c.deletedAt === undefined)
        : undefined;
      if (id && !existing) throw new Error("카테고리를 찾을 수 없습니다.");
      const trimmed = typeof name === "string" ? name.trim() : name;
      if (
        state.categories.some(
          (c) => c.id !== id && c.deletedAt === undefined && c.name === trimmed,
        )
      )
        throw new Error("같은 이름의 카테고리가 있습니다.");
      const revision = stamp(state);
      const record = parseCategory({
        id: existing?.id ?? crypto.randomUUID(),
        name: trimmed,
        color,
        createdAt: existing?.createdAt ?? revision.updatedAt,
        ...revision,
      });
      state.categories = [
        ...state.categories.filter((c) => c.id !== record.id),
        record,
      ];
      return record;
    });
  }

  async function deleteCategory(id: string): Promise<void> {
    return mutate((state) => {
      const record = state.categories.find(
        (c) => c.id === id && c.deletedAt === undefined,
      );
      if (!record) return;
      Object.assign(record, stamp(state));
      record.deletedAt = record.updatedAt;
      // Keep membership IDs as tombstones: older backups cannot reconnect a removed group.
      // UI and export resolve only live categories, leaving affected titles uncategorized.
    });
  }

  async function updateSettings(patch: SettingsPatch): Promise<Settings> {
    return mutate((state) => {
      state.settings = parseSettings({
        ...state.settings,
        subscribedProviders:
          patch.subscribedProviders ?? state.settings.subscribedProviders,
        region: patch.region ?? state.settings.region,
        openInNewTab: patch.openInNewTab ?? state.settings.openInNewTab,
        ...stamp(state),
      });
      return state.settings;
    });
  }

  async function importBackup(
    raw: unknown,
  ): Promise<{ bookmarks: number; categories: number }> {
    // Parse the entire file before opening a transaction: malformed files change nothing.
    const envelope = parseBackup(raw);
    return mutate((state) => {
      const incoming = structuredClone(envelope.data);
      state.clock = Math.max(state.clock, maxRevision(incoming));
      // Independently saved copies of the same provider title share the local identity.
      const byId = new Map(
        state.bookmarks.map((record) => [record.id, record]),
      );
      const byLink = new Map<string, Bookmark[]>();
      for (const local of state.bookmarks)
        for (const identity of linkKeys(local))
          byLink.set(identity, [...(byLink.get(identity) ?? []), local]);
      for (const record of incoming.bookmarks) {
        const matches = [
          ...new Set(
            [
              byId.get(record.id),
              ...[...linkKeys(record)].flatMap(
                (identity) => byLink.get(identity) ?? [],
              ),
            ].filter((b): b is Bookmark => Boolean(b)),
          ),
        ];
        if (matches.length > 1)
          throw new Error(
            "여러 작품을 하나로 연결하는 백업 충돌입니다. OTT 연결을 정리한 후 다시 가져와 주세요.",
          );
        if (matches[0]) record.id = matches[0].id;
      }
      if (
        new Set(incoming.bookmarks.map((b) => b.id)).size !==
        incoming.bookmarks.length
      )
        throw new Error("동일한 OTT 작품이 여러 번 포함된 백업입니다.");
      if (envelope.scope === "group") {
        incoming.settings = state.settings;
        incoming.bookmarks = incoming.bookmarks.map((record) => {
          const local = state.bookmarks.find((b) => b.id === record.id);
          if (!local) return { ...record, favorite: false, notes: "" };
          // A shared group is not permission to restore locally deleted personal records.
          if (local.deletedAt !== undefined) return local;
          const winner = latest(local, record);
          const combined = {
            ...winner,
            categoryIds: [
              ...new Set([...local.categoryIds, ...record.categoryIds]),
            ],
            favorite: local.favorite,
            notes: local.notes,
          };
          // This is a local edit of the shared projection, so give it a durable revision.
          // Re-importing an identical group does not manufacture another edit.
          return JSON.stringify(combined) === JSON.stringify(local)
            ? local
            : { ...combined, ...stamp(state) };
        });
      }
      const merged = mergeSnapshots(state, incoming);
      // Do not merge unrelated titles purely because their text happens to match.
      // A conflicting manual link must be resolved explicitly by the user.
      const identities = new Map<string, string>();
      for (const record of merged.bookmarks.filter(
        (b) => b.deletedAt === undefined,
      ))
        for (const identity of linkKeys(record)) {
          const owner = identities.get(identity);
          if (owner && owner !== record.id)
            throw new Error(
              "동일한 OTT 작품이 여러 북마크에 연결되어 있습니다. 연결을 정리한 후 다시 가져와 주세요.",
            );
          identities.set(identity, record.id);
        }
      state.bookmarks = merged.bookmarks;
      state.categories = merged.categories;
      state.settings = merged.settings;
      return {
        bookmarks: incoming.bookmarks.filter((b) => b.deletedAt === undefined)
          .length,
        categories: incoming.categories.filter((c) => c.deletedAt === undefined)
          .length,
      };
    });
  }

  async function exportBackup(categoryIds?: string[]): Promise<BackupEnvelope> {
    const current = await snapshot();
    let data = current;
    if (categoryIds !== undefined) {
      const selected = new Set(cleanCategoryIds(current, categoryIds));
      if (!selected.size)
        throw new Error("내보낼 카테고리를 하나 이상 선택해 주세요.");
      data = {
        schemaVersion: 1,
        categories: current.categories.filter(
          (c) => c.deletedAt === undefined && selected.has(c.id),
        ),
        bookmarks: current.bookmarks
          .filter(
            (b) =>
              b.deletedAt === undefined &&
              b.categoryIds.some((id) => selected.has(id)),
          )
          .map((b) => ({
            ...b,
            categoryIds: b.categoryIds.filter((id) => selected.has(id)),
            notes: "",
            favorite: false,
          })),
        settings: neutralSettings(),
      };
    }
    return {
      format: "ott-switch",
      schemaVersion: 1,
      exportedAt: Date.now(),
      scope: categoryIds === undefined ? "full" : "group",
      data,
    };
  }

  async function close(): Promise<void> {
    if (database) (await database).close();
    database = undefined;
  }
  return {
    snapshot,
    saveBookmark,
    updateBookmark,
    deleteBookmark,
    clearSearchResults,
    saveCategory,
    deleteCategory,
    updateSettings,
    importBackup,
    exportBackup,
    close,
  };
}

export const repository = createRepository();
