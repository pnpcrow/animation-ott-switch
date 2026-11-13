import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Availability,
  Bookmark,
  LibrarySnapshot,
  PageTitle,
  ProviderId,
} from "../src/core/types";

const mocks = vi.hoisted(() => ({
  snapshot: vi.fn(),
  searchProvider: vi.fn(),
  readDetailPage: vi.fn(),
  resolveRendered: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  get: vi.fn(),
}));
vi.mock("../src/core/repository", () => ({
  repository: { snapshot: mocks.snapshot },
}));
vi.mock("../src/providers/search", () => ({
  searchProvider: mocks.searchProvider,
  readDetailPage: mocks.readDetailPage,
}));
vi.mock("../src/background/rendered-search", () => ({
  resolveRendered: mocks.resolveRendered,
}));

const page: PageTitle = {
  provider: "laftel",
  url: "https://laftel.net/item/41666",
  title: "Frieren",
  aliases: [],
  description: "Source description",
  imageUrl: "",
  year: 2023,
};
const detailUrl = "https://www.netflix.com/title/81726714";
const sender: chrome.runtime.MessageSender = {
  id: "extension",
  url: page.url,
  tab: { id: 9, url: page.url } as chrome.tabs.Tab,
};
const unknown = (provider: ProviderId): Availability => ({
  provider,
  status: "unknown",
  checkedAt: Date.now(),
  reason: "Public HTML cannot be read",
});
const available = (provider: ProviderId, url: string): Availability => ({
  provider,
  status: "available",
  checkedAt: Date.now(),
  url,
  title: page.title,
});
let snapshot: LibrarySnapshot;
let resolution: typeof import("../src/background/resolution");

function savedBookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: "saved",
    title: page.title,
    aliases: [],
    description: "My custom description",
    imageUrl: "",
    categoryIds: [],
    favorite: false,
    notes: "Private note",
    createdAt: 1,
    updatedAt: 2,
    deviceId: "device",
    links: {
      laftel: {
        provider: "laftel",
        url: page.url,
        title: page.title,
        verifiedAt: 1,
        source: "page",
      },
    },
    ...overrides,
  };
}

beforeEach(async () => {
  vi.resetModules();
  Object.values(mocks).forEach((mock) => mock.mockReset());
  snapshot = {
    schemaVersion: 1,
    bookmarks: [],
    categories: [],
    settings: {
      id: "settings",
      subscribedProviders: [],
      region: "KR",
      openInNewTab: true,
      updatedAt: 1,
      deviceId: "device",
    },
  };
  mocks.snapshot.mockImplementation(async () => structuredClone(snapshot));
  mocks.searchProvider.mockImplementation(async (provider) =>
    unknown(provider),
  );
  mocks.readDetailPage.mockResolvedValue(null);
  mocks.resolveRendered.mockImplementation(async (provider) =>
    unknown(provider),
  );
  mocks.create.mockResolvedValue({ id: 10 });
  mocks.update.mockResolvedValue({ id: 9 });
  mocks.get.mockResolvedValue({ id: 9, url: page.url });
  vi.stubGlobal("chrome", {
    tabs: { create: mocks.create, update: mocks.update, get: mocks.get },
  });
  resolution = await import("../src/background/resolution");
});
afterEach(() => vi.unstubAllGlobals());

describe("public search and rendered fallback policy", () => {
  it("returns verified public detail links without opening a verification tab", async () => {
    mocks.searchProvider.mockResolvedValue(available("netflix", detailUrl));
    expect(await resolution.resolveProvider(page, "netflix")).toMatchObject({
      status: "available",
      url: detailUrl,
    });
    expect(mocks.resolveRendered).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("automatically renders only subscribed providers after public search fails", async () => {
    snapshot.settings.subscribedProviders = ["netflix"];
    mocks.resolveRendered.mockResolvedValue(available("netflix", detailUrl));
    expect((await resolution.resolveProvider(page, "netflix")).status).toBe(
      "available",
    );
    expect((await resolution.resolveProvider(page, "crunchyroll")).status).toBe(
      "unknown",
    );
    expect(mocks.resolveRendered).toHaveBeenCalledTimes(1);
    expect(mocks.resolveRendered).toHaveBeenCalledWith(
      "netflix",
      expect.objectContaining({ title: "Frieren" }),
    );
  });

  it("explicit switching upgrades an earlier unknown cache using the user's browser session", async () => {
    await resolution.resolveProvider(page, "netflix");
    expect(mocks.resolveRendered).not.toHaveBeenCalled();
    mocks.resolveRendered.mockResolvedValue(available("netflix", detailUrl));
    const result = await resolution.openResolved(
      page,
      "netflix",
      undefined,
      sender,
    );
    expect(result).toMatchObject({
      status: "available",
      url: detailUrl,
      opened: true,
    });
    expect(mocks.resolveRendered).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledWith({ url: detailUrl, active: true });
    expect(mocks.create.mock.calls[0][0].url).not.toContain("search");
  });

  it.each(["unknown", "unavailable", "ambiguous"] as const)(
    "does not navigate an unresolved %s result",
    async (status) => {
      mocks.resolveRendered.mockResolvedValue({
        ...unknown("netflix"),
        status,
      });
      const result = await resolution.openResolved(
        page,
        "netflix",
        undefined,
        sender,
      );
      expect(result.status).toBe(status);
      expect(mocks.create).not.toHaveBeenCalled();
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );

  it("revalidates a selected candidate before opening it and leaves mismatches unopened", async () => {
    mocks.resolveRendered.mockResolvedValue(unknown("netflix"));
    await resolution.openResolved(page, "netflix", detailUrl, sender);
    expect(mocks.resolveRendered).toHaveBeenCalledWith(
      "netflix",
      expect.objectContaining({ title: "Frieren" }),
      detailUrl,
    );
    expect(mocks.searchProvider).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    mocks.resolveRendered.mockResolvedValue(available("netflix", detailUrl));
    await resolution.openResolved(page, "netflix", detailUrl, sender);
    expect(mocks.create).toHaveBeenCalledWith({ url: detailUrl, active: true });
  });

  it("never navigates to a search URL incorrectly returned as available", async () => {
    mocks.searchProvider.mockResolvedValue(
      available("netflix", "https://www.netflix.com/search?q=Frieren"),
    );
    await resolution.openResolved(page, "netflix", undefined, sender);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("does not replace the source tab if the user navigated while resolution was running", async () => {
    snapshot.settings.openInNewTab = false;
    mocks.searchProvider.mockResolvedValue(available("netflix", detailUrl));
    mocks.get.mockResolvedValue({
      id: 9,
      url: "https://laftel.net/item/99999",
    });
    expect(
      await resolution.openResolved(page, "netflix", undefined, sender),
    ).toMatchObject({ status: "available", url: detailUrl, opened: false });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("replaces the unchanged source tab with the verified detail URL when configured", async () => {
    snapshot.settings.openInNewTab = false;
    mocks.searchProvider.mockResolvedValue(available("netflix", detailUrl));
    expect(
      await resolution.openResolved(page, "netflix", undefined, sender),
    ).toMatchObject({ opened: true });
    expect(mocks.update).toHaveBeenCalledWith(9, { url: detailUrl });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe("legacy title repair and resolution cache", () => {
  it.each([
    "Crunchyroll: Watch Popular Anime, Play Games & Shop Online",
    "Another Movie",
  ])(
    "never replaces the requested work with an unrelated refreshed title: %s",
    async (title) => {
      const source = {
        ...page,
        provider: "crunchyroll" as const,
        url: "https://www.crunchyroll.com/series/G123",
        title: "Watch Dogs",
      };
      mocks.readDetailPage.mockResolvedValue({ ...source, title });
      await resolution.resolveProvider(source, "watcha");
      expect(mocks.searchProvider).toHaveBeenCalledWith(
        "watcha",
        expect.objectContaining({
          title: "Watch Dogs",
          aliases: [],
        }),
      );
    },
  );
  it("repairs the reported Korean prefix even when source refresh is unavailable", async () => {
    const source = {
      ...page,
      provider: "crunchyroll" as const,
      url: "https://www.crunchyroll.com/series/G123",
      title: "Watch 어느 마녀가 죽을 때까지",
      aliases: ["Watch 어느 마녀가 죽을 때까지"],
    };
    mocks.readDetailPage.mockResolvedValue(null);
    await resolution.resolveProvider(source, "laftel");
    expect(mocks.searchProvider).toHaveBeenCalledWith(
      "laftel",
      expect.objectContaining({
        title: "어느 마녀가 죽을 때까지",
        aliases: [],
      }),
    );
    expect(mocks.readDetailPage).not.toHaveBeenCalled();
  });
  it("uses refreshed official source evidence rather than a dirty bookmark confirming itself", async () => {
    const dirty = {
      ...page,
      provider: "netflix" as const,
      url: detailUrl,
      title: "Watch Frieren",
      aliases: ["Watch Frieren"],
    };
    snapshot.bookmarks = [
      savedBookmark({
        title: "Watch Frieren",
        aliases: ["Watch Frieren"],
        links: {
          netflix: {
            provider: "netflix",
            url: detailUrl,
            title: "Watch Frieren",
            verifiedAt: 1,
            source: "page",
          },
        },
      }),
    ];
    const original = structuredClone(snapshot);
    mocks.readDetailPage.mockResolvedValue({
      ...dirty,
      title: "Frieren",
      aliases: ["葬送のフリーレン"],
    });
    await resolution.resolveProvider(dirty, "laftel");
    await resolution.resolveProvider(dirty, "laftel", true);
    expect(mocks.readDetailPage).toHaveBeenCalledTimes(1);
    expect(mocks.readDetailPage).toHaveBeenCalledWith("netflix", detailUrl);
    const query = mocks.searchProvider.mock.calls[0][1] as PageTitle;
    expect(query.title).toBe("Frieren");
    expect(query.aliases).toEqual(["葬送のフリーレン"]);
    expect(snapshot).toEqual(original);
  });

  it("retains authentic Watch title words confirmed by refreshed source metadata", async () => {
    const source = {
      ...page,
      provider: "netflix" as const,
      url: detailUrl,
      title: "Watch Dogs",
    };
    mocks.readDetailPage.mockResolvedValue(source);
    await resolution.resolveProvider(source, "laftel");
    expect(mocks.searchProvider.mock.calls[0][1].title).toBe("Watch Dogs");
  });

  it("keeps an unproven title when refreshing the official source is blocked", async () => {
    const source = {
      ...page,
      provider: "netflix" as const,
      url: detailUrl,
      title: "Watch Dogs",
    };
    mocks.readDetailPage.mockResolvedValue(null);
    await resolution.resolveProvider(source, "laftel");
    expect(mocks.searchProvider.mock.calls[0][1].title).toBe("Watch Dogs");
  });

  it("uses existing canonical source links, while force bypasses the saved target link", async () => {
    snapshot.bookmarks = [
      savedBookmark({
        links: {
          laftel: {
            provider: "laftel",
            url: page.url + "/title?utm_source=saved",
            title: page.title,
            verifiedAt: 1,
            source: "page",
          },
          netflix: {
            provider: "netflix",
            url: detailUrl,
            title: page.title,
            verifiedAt: 2,
            source: "manual",
          },
        },
      }),
    ];
    expect((await resolution.resolveProvider(page, "netflix")).url).toBe(
      detailUrl,
    );
    expect(mocks.searchProvider).not.toHaveBeenCalled();
    mocks.searchProvider.mockResolvedValue(
      available("netflix", "https://www.netflix.com/title/99999999"),
    );
    expect(
      (await resolution.resolveProvider(page, "netflix", true)).url,
    ).toContain("99999999");
    expect(mocks.searchProvider).toHaveBeenCalledTimes(1);
  });

  it("caches valid results and invalidates or forces the next lookup", async () => {
    mocks.searchProvider.mockResolvedValue(available("netflix", detailUrl));
    await resolution.resolveProvider(page, "netflix");
    await resolution.resolveProvider(page, "netflix");
    expect(mocks.searchProvider).toHaveBeenCalledTimes(1);
    resolution.invalidateResolutions();
    await resolution.resolveProvider(page, "netflix");
    expect(mocks.searchProvider).toHaveBeenCalledTimes(2);
    await resolution.resolveProvider(page, "netflix", true);
    expect(mocks.searchProvider).toHaveBeenCalledTimes(3);
  });

  it("deduplicates concurrent lookups of the same query", async () => {
    let finish!: (value: Availability) => void;
    mocks.searchProvider.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const a = resolution.resolveProvider(page, "netflix");
    const b = resolution.resolveProvider(page, "netflix");
    await vi.waitFor(() =>
      expect(mocks.searchProvider).toHaveBeenCalledTimes(1),
    );
    finish(available("netflix", detailUrl));
    expect(await a).toEqual(await b);
    expect(mocks.searchProvider).toHaveBeenCalledTimes(1);
  });

  it("does not let a pre-invalidation in-flight lookup replace the refreshed cache", async () => {
    let finishOld!: (value: Availability) => void;
    mocks.searchProvider.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    );
    const old = resolution.resolveProvider(page, "netflix");
    await vi.waitFor(() =>
      expect(mocks.searchProvider).toHaveBeenCalledTimes(1),
    );
    resolution.invalidateResolutions();
    const nextUrl = "https://www.netflix.com/title/99999999";
    mocks.searchProvider.mockResolvedValue(available("netflix", nextUrl));
    await resolution.resolveProvider(page, "netflix");
    finishOld(available("netflix", detailUrl));
    await old;
    expect((await resolution.resolveProvider(page, "netflix")).url).toBe(
      nextUrl,
    );
    expect(mocks.searchProvider).toHaveBeenCalledTimes(2);
  });
});
