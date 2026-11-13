import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PageTitle, ProviderId } from "../src/core/types";

const mocks = vi.hoisted(() => ({ searchProvider: vi.fn() }));
vi.mock("../src/providers/search", () => ({
  searchProvider: mocks.searchProvider,
}));

type Reply = { ok: boolean; data?: unknown; error?: string };
type Listener = (
  request: unknown,
  sender: chrome.runtime.MessageSender,
  reply: (value: Reply) => void,
) => unknown;
let listener: Listener;
let repository: (typeof import("../src/core/repository"))["repository"];
const extensionId = "ott-switch-test";
const internal = {
  id: extensionId,
  url: `chrome-extension://${extensionId}/library.html`,
};
const content = { id: extensionId, url: "https://laftel.net/item/12345" };
const page: PageTitle = {
  title: "마녀의 여행",
  aliases: [],
  description: "여행 이야기",
  imageUrl: "https://example.com/poster.jpg",
  provider: "laftel",
  url: "https://laftel.net/item/12345",
};
const send = (
  action: string,
  args: unknown[],
  sender = internal,
): Promise<Reply> =>
  new Promise((resolve) => {
    expect(
      listener({ channel: "ott-switch", action, args }, sender, resolve),
    ).toBe(true);
  });

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  mocks.searchProvider
    .mockReset()
    .mockImplementation(async (provider: ProviderId) => ({
      provider,
      status: "unknown",
      checkedAt: Date.now(),
      reason: "테스트 검색 제한",
    }));
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
      query: vi.fn().mockResolvedValue([]),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue({}),
    },
    action: { onClicked: { addListener: vi.fn() } },
  });
  ({ repository } = await import("../src/core/repository"));
  await import("../src/background/index");
});
afterEach(async () => {
  await repository.close();
  vi.unstubAllGlobals();
});

describe("service worker message boundary", () => {
  it("ignores messages on other channels and rejects foreign sender IDs/hosts", async () => {
    const reply = vi.fn();
    expect(
      listener(
        { channel: "elsewhere", action: "snapshot", args: [] },
        internal,
        reply,
      ),
    ).toBeUndefined();
    expect(reply).not.toHaveBeenCalled();
    expect(
      (await send("snapshot", [], { ...internal, id: "another-extension" })).ok,
    ).toBe(false);
    expect(
      (
        await send("snapshot", [], {
          id: extensionId,
          url: "https://laftel.net.evil.example/item/12345",
        })
      ).ok,
    ).toBe(false);
    expect((await send("snapshot", [], internal)).ok).toBe(true);
  });

  it("requires the internal library for imports, exports and destructive/settings actions", async () => {
    for (const action of [
      "importBackup",
      "exportBackup",
      "deleteCategory",
      "updateSettings",
      "deleteBookmark",
    ]) {
      const response = await send(action, [], content);
      expect(response.ok).toBe(false);
      expect(response.error).toContain("보관함");
    }
    expect((await send("exportBackup", [], internal)).ok).toBe(true);
  });

  it("rejects malformed page payloads before persisting or searching", async () => {
    expect(
      (
        await send(
          "saveBookmark",
          [
            {
              page: { ...page, url: "https://evil.example/item/12345" },
              categoryIds: [],
            },
          ],
          content,
        )
      ).ok,
    ).toBe(false);
    expect(
      (await send("lookup", [{ ...page, aliases: ["x".repeat(501)] }], content))
        .ok,
    ).toBe(false);
    expect(
      (
        await send(
          "lookup",
          [{ ...page, description: "x".repeat(20_001) }],
          content,
        )
      ).ok,
    ).toBe(false);
    expect(mocks.searchProvider).not.toHaveBeenCalled();
    expect((await repository.snapshot()).bookmarks).toHaveLength(0);
  });

  it("stores one atomic title with validated additional links from a supported page", async () => {
    const netflix = {
      provider: "netflix",
      url: "https://www.netflix.com/title/80123456",
      title: page.title,
      verifiedAt: Date.now(),
      source: "search",
    };
    const response = await send(
      "saveBookmark",
      [{ page, categoryIds: ["watchlist"], links: { netflix } }],
      content,
    );
    expect(response.ok).toBe(true);
    const state = await repository.snapshot();
    expect(state.bookmarks).toHaveLength(1);
    expect(state.bookmarks[0].links.netflix?.url).toBe(netflix.url);
    const rejected = await send(
      "saveBookmark",
      [
        {
          page: { ...page, url: "https://laftel.net/item/99999" },
          categoryIds: [],
          links: { netflix },
        },
      ],
      content,
    );
    expect(rejected.ok).toBe(false);
    expect((await repository.snapshot()).bookmarks).toHaveLength(1);
  });

  it("finds saved provider links across canonical URL and slug/tracking variants", async () => {
    await repository.saveBookmark({
      page,
      categoryIds: [],
      links: {
        netflix: {
          provider: "netflix",
          url: "https://www.netflix.com/title/80123456",
          title: page.title,
          verifiedAt: Date.now(),
          source: "manual",
        },
      },
    });
    const response = await send(
      "lookup",
      [{ ...page, url: "https://laftel.net/item/12345/new-slug?tracking=1" }],
      content,
    );
    expect(response.ok).toBe(true);
    const results = response.data as {
      provider: ProviderId;
      status: string;
      reason: string;
    }[];
    expect(results.find((r) => r.provider === "netflix")?.status).toBe(
      "available",
    );
    expect(results.find((r) => r.provider === "netflix")?.reason).toContain(
      "보관함",
    );
    expect(
      mocks.searchProvider.mock.calls.some((call) => call[0] === "netflix"),
    ).toBe(false);
  });

  it("deduplicates concurrent lookups and treats search failures as unknown, never unavailable", async () => {
    mocks.searchProvider.mockRejectedValue(new Error("offline"));
    const [a, b] = await Promise.all([
      send("lookup", [page], content),
      send("lookup", [page], content),
    ]);
    expect(a).toEqual(b);
    const results = a.data as { provider: ProviderId; status: string }[];
    expect(results).toHaveLength(10);
    expect(
      results
        .filter((r) => r.provider !== "laftel")
        .every((r) => r.status === "unknown"),
    ).toBe(true);
    expect(mocks.searchProvider).toHaveBeenCalledTimes(9);
    await send("lookup", [page], content);
    expect(mocks.searchProvider).toHaveBeenCalledTimes(9);
    await send("lookup", [page, true], content);
    expect(mocks.searchProvider).toHaveBeenCalledTimes(18);
  });
});
