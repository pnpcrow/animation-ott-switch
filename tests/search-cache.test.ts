import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Availability, PageTitle, ProviderId } from "../src/core/types";

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  source: vi.fn(),
  rendered: vi.fn(),
}));
vi.mock("../src/providers/search", () => ({
  searchProvider: mocks.search,
  readDetailPage: mocks.source,
}));
vi.mock("../src/background/rendered-search", () => ({
  resolveRendered: mocks.rendered,
}));
type Reply = { ok: boolean; data?: any; error?: string };
type Listener = (
  request: unknown,
  sender: chrome.runtime.MessageSender,
  reply: (value: Reply) => void,
) => unknown;
let listener: Listener;
let repository: (typeof import("../src/core/repository"))["repository"];
const extensionId = "search-reset-test";
const internal = {
  id: extensionId,
  url: `chrome-extension://${extensionId}/library.html`,
};
const page: PageTitle = {
  provider: "laftel",
  url: "https://laftel.net/item/42783",
  title: "어느 마녀가 죽을 때까지",
  aliases: [],
  description: "My description",
  imageUrl: "https://example.com/cover.jpg",
};
const content = {
  id: extensionId,
  url: page.url,
  tab: { id: 7, url: page.url } as chrome.tabs.Tab,
};
const available = (
  provider: ProviderId,
  url = "https://www.netflix.com/title/900001",
): Availability => ({
  provider,
  status: "available",
  checkedAt: Date.now(),
  title: page.title,
  url,
});
const send = (
  action: string,
  args: unknown[] = [],
  sender: chrome.runtime.MessageSender = internal,
): Promise<Reply> =>
  new Promise((resolve) => {
    listener({ channel: "ott-switch", action, args }, sender, resolve);
  });

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  mocks.search
    .mockReset()
    .mockImplementation(async (provider: ProviderId) => available(provider));
  mocks.source.mockReset().mockResolvedValue(null);
  mocks.rendered.mockReset().mockResolvedValue({
    provider: "netflix",
    status: "unknown",
    checkedAt: Date.now(),
  });
  vi.stubGlobal("chrome", {
    runtime: {
      id: extensionId,
      getURL: (path: string) => `chrome-extension://${extensionId}/${path}`,
      onMessage: {
        addListener: (value: Listener) => {
          listener = value;
        },
      },
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
    tabs: {
      query: vi.fn().mockResolvedValue([
        { id: 7, url: page.url },
        { id: 8, url: "https://example.com/" },
      ]),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue({ id: 99 }),
      get: vi.fn().mockResolvedValue({ id: 7, url: page.url }),
      update: vi.fn().mockResolvedValue({}),
    },
    action: { onClicked: { addListener: vi.fn() } },
    storage: {
      local: { setAccessLevel: vi.fn().mockResolvedValue(undefined) },
    },
  });
  ({ repository } = await import("../src/core/repository"));
  await import("../src/background/index");
});
afterEach(async () => {
  await repository.close();
  vi.unstubAllGlobals();
});

describe("search result reset", () => {
  it("removes only automatic links and atomically preserves bookmarks, user fields, manual/page links and settings", async () => {
    const saved = await repository.saveBookmark({
      page,
      categoryIds: ["watchlist"],
      links: {
        netflix: {
          provider: "netflix",
          url: "https://www.netflix.com/title/900001",
          title: page.title,
          verifiedAt: 1,
          source: "search",
        },
        prime: {
          provider: "prime",
          url: "https://www.primevideo.com/detail/B012345678",
          title: page.title,
          verifiedAt: 2,
          source: "manual",
        },
        wavve: {
          provider: "wavve",
          url: "https://www.wavve.com/player/vod?programid=CF02_TEST",
          title: page.title,
          verifiedAt: 3,
          source: "page",
        },
      },
    });
    await repository.updateBookmark(saved.id, {
      notes: "Personal notes",
      favorite: true,
      aliases: ["Original title"],
    });
    const untouched = await repository.saveBookmark({
      page: {
        ...page,
        url: "https://laftel.net/item/1",
        title: "Another title",
      },
      categoryIds: [],
    });
    const before = await repository.snapshot();
    const response = await send("clearSearchResults", [], content);
    expect(response).toEqual({ ok: true, data: { links: 1, bookmarks: 1 } });
    const after = await repository.snapshot();
    const original = before.bookmarks.find((b) => b.id === saved.id)!;
    const result = after.bookmarks.find((b) => b.id === saved.id)!;
    expect(result.updatedAt).toBeGreaterThan(original.updatedAt);
    expect(result).toEqual({
      ...original,
      updatedAt: result.updatedAt,
      deviceId: result.deviceId,
      links: {
        laftel: original.links.laftel,
        prime: original.links.prime,
        wavve: original.links.wavve,
      },
    });
    expect(after.bookmarks.find((b) => b.id === untouched.id)).toEqual(
      untouched,
    );
    expect(after.settings).toEqual(before.settings);
    expect(after.categories).toEqual(before.categories);
    expect(await send("clearSearchResults")).toEqual({
      ok: true,
      data: { links: 0, bookmarks: 0 },
    });
    expect((await repository.snapshot()).bookmarks).toEqual(after.bookmarks);
  });

  it("broadcasts a dedicated reset before changed to the library and supported content tabs", async () => {
    await send("clearSearchResults");
    expect(
      vi.mocked(chrome.runtime.sendMessage).mock.calls.map((c) => c[0]),
    ).toEqual([
      { channel: "ott-switch", event: "search-results-cleared" },
      { channel: "ott-switch", event: "changed" },
    ]);
    expect(vi.mocked(chrome.tabs.sendMessage).mock.calls).toEqual([
      [7, { channel: "ott-switch", event: "search-results-cleared" }],
      [7, { channel: "ott-switch", event: "changed" }],
    ]);
  });

  it("clears both current provider resolution and the legacy lookup cache", async () => {
    await send("resolveProvider", [page, "netflix"]);
    await send("resolveProvider", [page, "netflix"]);
    expect(mocks.search).toHaveBeenCalledTimes(1);
    await send("lookup", [page]);
    await send("lookup", [page]);
    const count = mocks.search.mock.calls.length;
    expect(count).toBe(10);
    await send("clearSearchResults");
    await send("resolveProvider", [page, "netflix"]);
    await send("lookup", [page]);
    expect(mocks.search).toHaveBeenCalledTimes(count + 10);
  });

  it("clears source title refresh cache as well as availability", async () => {
    const source = {
      ...page,
      provider: "crunchyroll" as const,
      url: "https://www.crunchyroll.com/series/G123",
      title: "Watch Dogs",
    };
    mocks.source.mockResolvedValue(source);
    await send("resolveProvider", [source, "netflix"]);
    await send("resolveProvider", [source, "netflix", true]);
    expect(mocks.source).toHaveBeenCalledTimes(1);
    await send("clearSearchResults");
    await send("resolveProvider", [source, "netflix"]);
    expect(mocks.source).toHaveBeenCalledTimes(2);
  });

  it("does not repopulate cleared results when an old search finishes after reset", async () => {
    let finish!: (value: Availability) => void;
    mocks.search.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const old = send("resolveProvider", [page, "netflix"]);
    await vi.waitFor(() => expect(mocks.search).toHaveBeenCalledTimes(1));
    await send("clearSearchResults");
    const url = "https://www.netflix.com/title/900002";
    mocks.search.mockResolvedValue(available("netflix", url));
    expect((await send("resolveProvider", [page, "netflix"])).data.url).toBe(
      url,
    );
    finish(available("netflix"));
    expect((await old).data.status).toBe("unknown");
    expect((await send("resolveProvider", [page, "netflix"])).data.url).toBe(
      url,
    );
    expect(mocks.search).toHaveBeenCalledTimes(2);
  });

  it("cancels an old source refresh and does not let its completion refill the source cache", async () => {
    const source = {
      ...page,
      provider: "crunchyroll" as const,
      url: "https://www.crunchyroll.com/series/G123",
      title: "Watch Dogs",
    };
    let finish!: (value: PageTitle) => void;
    mocks.source.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const old = send("resolveProvider", [source, "netflix"]);
    await vi.waitFor(() => expect(mocks.source).toHaveBeenCalledTimes(1));
    await send("clearSearchResults");
    mocks.source.mockResolvedValue(source);
    await send("resolveProvider", [source, "netflix"]);
    finish(source);
    expect((await old).data.status).toBe("unknown");
    await send("resolveProvider", [source, "netflix", true]);
    expect(mocks.source).toHaveBeenCalledTimes(2);
    expect(mocks.search).toHaveBeenCalledTimes(2);
  });

  it.each(["resolveProvider", "openResolved"])(
    "does not start a stale source refresh after %s finishes a pending initial snapshot",
    async (action) => {
      const source = {
        ...page,
        provider: "crunchyroll" as const,
        url: "https://www.crunchyroll.com/series/G123",
        title: "Watch Dogs",
      };
      const snapshot = await repository.snapshot();
      let finish!: (value: typeof snapshot) => void;
      vi.spyOn(repository, "snapshot").mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const old = send(action, [source, "netflix"]);
      await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
      await send("clearSearchResults");
      finish(snapshot);
      expect((await old).data.status).toBe("unknown");
      expect(mocks.source).not.toHaveBeenCalled();
      expect(mocks.search).not.toHaveBeenCalled();
      expect(chrome.tabs.create).not.toHaveBeenCalled();
    },
  );

  it("does not open a stale find-and-switch result after the user resets searches", async () => {
    let finish!: (value: Availability) => void;
    mocks.search.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const opening = send("openResolved", [page, "netflix"], content);
    await vi.waitFor(() => expect(mocks.search).toHaveBeenCalledTimes(1));
    await send("clearSearchResults");
    finish(available("netflix"));
    expect((await opening).data.status).toBe("unknown");
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });

  it("cancels a same-tab switch when reset happens during the final tab check", async () => {
    await repository.updateSettings({ openInNewTab: false });
    let finish!: (value: chrome.tabs.Tab) => void;
    vi.mocked(chrome.tabs.get).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const opening = send("openResolved", [page, "netflix"], content);
    await vi.waitFor(() => expect(chrome.tabs.get).toHaveBeenCalledTimes(1));
    await send("clearSearchResults");
    finish({ id: 7, url: page.url } as chrome.tabs.Tab);
    expect((await opening).data.status).toBe("unknown");
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });

  it("rejects extra arguments and foreign senders", async () => {
    expect((await send("clearSearchResults", [page])).ok).toBe(false);
    expect(
      (
        await send("clearSearchResults", [], {
          id: "foreign",
          url: internal.url,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await send("clearSearchResults", [], {
          id: extensionId,
          url: "https://example.com/",
        })
      ).ok,
    ).toBe(false);
  });
});
