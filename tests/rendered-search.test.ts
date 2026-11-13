import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PageTitle } from "../src/core/types";
import type { ProbeReply, ProbeRequest } from "../src/core/probe";

type TestTab = {
  id: number;
  active: boolean;
  url: string;
  pendingUrl?: string;
  status: string;
  muted?: boolean;
};
type Activated = (info: { tabId: number }) => void;
type Updated = (tabId: number, info: { url?: string }) => void;
type Removed = (tabId: number) => void;

let resolveRendered: (typeof import("../src/background/rendered-search"))["resolveRendered"];
let tabs: Map<number, TestTab>;
let activated: Set<Activated>;
let updated: Set<Updated>;
let removed: Set<Removed>;
let nextId: number;
let maxOpen: number;
let onCreate: ((tab: TestTab) => void) | undefined;
let probe: (
  tab: TestTab,
  request: ProbeRequest,
) => ProbeReply | Promise<ProbeReply>;
let create: ReturnType<typeof vi.fn>;
let update: ReturnType<typeof vi.fn>;
let remove: ReturnType<typeof vi.fn>;
let sendMessage: ReturnType<typeof vi.fn>;
let get: ReturnType<typeof vi.fn>;

const page: PageTitle = {
  provider: "laftel",
  title: "장송의 프리렌",
  aliases: [],
  description: "마법사의 여행",
  imageUrl: "",
  url: "https://laftel.net/item/41666",
  year: 2023,
};
const detailUrl = "https://www.netflix.com/title/81726714";
const detail: PageTitle = { ...page, provider: "netflix", url: detailUrl };
const changeUrl = (tab: TestTab, url: string) => {
  tab.url = url;
  tab.pendingUrl = undefined;
  for (const listener of updated) listener(tab.id, { url });
};
const activate = (tab: TestTab) => {
  tab.active = true;
  for (const listener of activated) listener({ tabId: tab.id });
};
const event = <T>(listeners: Set<T>) => ({
  addListener: (listener: T) => listeners.add(listener),
  removeListener: (listener: T) => listeners.delete(listener),
});
const successfulProbe = (tab: TestTab, request: ProbeRequest): ProbeReply => ({
  token: request.token,
  url: tab.url,
  ready: true,
  ...(request.kind === "search"
    ? { candidates: [{ title: page.title, url: detailUrl }], complete: false }
    : { detail }),
});

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-13T00:00:00Z"));
  tabs = new Map();
  activated = new Set();
  updated = new Set();
  removed = new Set();
  nextId = 1;
  maxOpen = 0;
  onCreate = undefined;
  probe = successfulProbe;
  create = vi.fn(async (properties: { url: string; active: boolean }) => {
    const tab = {
      id: nextId++,
      active: properties.active,
      url: properties.url,
      status: "complete",
    };
    tabs.set(tab.id, tab);
    maxOpen = Math.max(maxOpen, tabs.size);
    onCreate?.(tab);
    return { ...tab };
  });
  update = vi.fn(async (id: number, changes: Partial<TestTab>) => {
    const tab = tabs.get(id);
    if (!tab) throw new Error("No such tab");
    Object.assign(tab, changes);
    if (changes.url) changeUrl(tab, changes.url);
    return { ...tab };
  });
  remove = vi.fn(async (id: number) => {
    tabs.delete(id);
    for (const listener of removed) listener(id);
  });
  sendMessage = vi.fn(async (id: number, request: ProbeRequest) => {
    const tab = tabs.get(id);
    if (!tab) throw new Error("No such tab");
    return probe(tab, request);
  });
  get = vi.fn(async (id: number) => {
    const tab = tabs.get(id);
    if (!tab) throw new Error("No such tab");
    return { ...tab };
  });
  vi.stubGlobal("chrome", {
    tabs: {
      create,
      update,
      remove,
      sendMessage,
      get,
      onActivated: event(activated),
      onUpdated: event(updated),
      onRemoved: event(removed),
    },
  });
  ({ resolveRendered } = await import("../src/background/rendered-search"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function finish(operation: ReturnType<typeof resolveRendered>) {
  await vi.runAllTimersAsync();
  return operation;
}

describe("rendered search tab ownership and verification", () => {
  it("uses an inactive muted helper, verifies matching detail, then removes only that helper", async () => {
    const result = await finish(resolveRendered("netflix", page));
    expect(result).toMatchObject({
      provider: "netflix",
      status: "available",
      url: detailUrl,
    });
    expect(create).toHaveBeenCalledWith({
      active: false,
      url: "https://www.netflix.com/search?q=%EC%9E%A5%EC%86%A1%EC%9D%98%20%ED%94%84%EB%A6%AC%EB%A0%8C",
    });
    expect(update).toHaveBeenCalledWith(1, { muted: true });
    expect(update).toHaveBeenCalledWith(1, { url: detailUrl, active: false });
    expect(
      update.mock.calls.some(([, changes]) => changes.active === true),
    ).toBe(false);
    expect(remove).toHaveBeenCalledExactlyOnceWith(1);
    expect(activated.size + updated.size + removed.size).toBe(0);
  });

  it.each(["during create", "during search"])(
    "closes an automatic same-site login redirect %s without leaking a login tab",
    async (when) => {
      let redirected = false;
      if (when === "during create")
        onCreate = (tab) =>
          changeUrl(tab, "https://www.netflix.com/login?next=search");
      else
        probe = (tab, request) => {
          if (!redirected) {
            redirected = true;
            changeUrl(tab, "https://www.netflix.com/login?next=search");
          }
          return {
            token: request.token,
            url: tab.url,
            ready: true,
            blocked: true,
          };
        };
      const result = await finish(resolveRendered("netflix", page));
      expect(result.status).toBe("unknown");
      expect(result.reason).toContain("로그인");
      expect(remove).toHaveBeenCalledExactlyOnceWith(1);
      expect(tabs.size).toBe(0);
      expect(update.mock.calls.some(([, changes]) => !!changes.url)).toBe(
        false,
      );
    },
  );

  it.each(["during create", "during search"])(
    "preserves a user-activated helper %s even if it is inactive again",
    async (when) => {
      let touched = false;
      const touch = (tab: TestTab) => {
        activate(tab);
        tab.active = false;
      };
      if (when === "during create") onCreate = touch;
      else
        probe = (tab, request) => {
          if (!touched) {
            touched = true;
            touch(tab);
          }
          return successfulProbe(tab, request);
        };
      const result = await finish(resolveRendered("netflix", page));
      expect(result.status).toBe("unknown");
      expect(result.reason).toContain("중단");
      expect(remove).not.toHaveBeenCalled();
      expect(update.mock.calls.some(([, changes]) => !!changes.url)).toBe(
        false,
      );
      expect(tabs.get(1)?.active).toBe(false);
    },
  );

  it("preserves an unexpected destination instead of navigating or closing it", async () => {
    let changed = false;
    probe = (tab, request) => {
      if (!changed) {
        changed = true;
        changeUrl(tab, "https://www.netflix.com/browse");
      }
      return { token: request.token, url: tab.url, ready: true };
    };
    expect((await finish(resolveRendered("netflix", page))).status).toBe(
      "unknown",
    );
    expect(remove).not.toHaveBeenCalled();
    expect(update.mock.calls.some(([, changes]) => !!changes.url)).toBe(false);
    expect(tabs.get(1)?.url).toBe("https://www.netflix.com/browse");
  });
  it("preserves activation during final cleanup even when the helper is inactive again", async () => {
    let detailReplies = 0;
    let touched = false;
    probe = (tab, request) => {
      if (request.kind === "detail") detailReplies++;
      return successfulProbe(tab, request);
    };
    get.mockImplementation(async (id: number) => {
      const tab = tabs.get(id)!;
      // Four stable detail probes complete the verification; the next read is cleanup.
      if (detailReplies >= 4 && !touched) {
        touched = true;
        activate(tab);
        tab.active = false;
      }
      return { ...tab };
    });
    await finish(resolveRendered("netflix", page));
    expect(touched).toBe(true);
    expect(remove).not.toHaveBeenCalled();
    expect(tabs.get(1)?.active).toBe(false);
  });
  it("cleans an owned about:blank helper when the requested navigation never commits", async () => {
    onCreate = (tab) => {
      tab.pendingUrl = tab.url;
      tab.url = "about:blank";
      tab.status = "loading";
    };
    sendMessage.mockRejectedValue(new Error("Content script has not loaded"));
    expect((await finish(resolveRendered("netflix", page))).status).toBe(
      "unknown",
    );
    expect(remove).toHaveBeenCalledExactlyOnceWith(1);
    expect(tabs.size).toBe(0);
  });

  it.each([{ ready: false }, { ready: true, loading: true }])(
    "drops partial candidate data when the search times out: %j",
    async (flags) => {
      probe = (tab, request) => ({
        ...successfulProbe(tab, request),
        ...flags,
      });
      const result = await finish(resolveRendered("netflix", page));
      expect(result.status).toBe("unknown");
      expect(result.url).toBeUndefined();
      expect(result.candidates).toBeUndefined();
      expect(update.mock.calls.some(([, changes]) => !!changes.url)).toBe(
        false,
      );
      expect(remove).toHaveBeenCalledExactlyOnceWith(1);
    },
  );

  it.each([
    { ...detail, title: "장송의 프리렌 2기" },
    { ...detail, year: 2020 },
    { ...detail, url: "https://www.netflix.com/title/99999999" },
  ])(
    "rejects a mismatched detail after the search result label matches: %j",
    async (target) => {
      probe = (tab, request) =>
        request.kind === "search"
          ? successfulProbe(tab, request)
          : { token: request.token, url: tab.url, ready: true, detail: target };
      const result = await finish(resolveRendered("netflix", page));
      expect(result.status).toBe("unknown");
      expect(result.url).toBeUndefined();
      expect(remove).toHaveBeenCalledExactlyOnceWith(1);
    },
  );

  it("does not accept replies from another token or another page", async () => {
    probe = (tab, request) => ({
      ...successfulProbe(tab, request),
      token: "unrelated-task",
      url: "https://www.netflix.com/search?q=other",
    });
    const result = await finish(resolveRendered("netflix", page));
    expect(result.status).toBe("unknown");
    expect(update.mock.calls.some(([, changes]) => !!changes.url)).toBe(false);
    expect(remove).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("bounds concurrent helper tabs to two and releases slots for queued work", async () => {
    const operations = [
      resolveRendered("netflix", page),
      resolveRendered("netflix", page),
      resolveRendered("netflix", page),
    ];
    await vi.advanceTimersByTimeAsync(0);
    expect(create).toHaveBeenCalledTimes(2);
    await vi.runAllTimersAsync();
    const results = await Promise.all(operations);
    expect(results.every((result) => result.status === "available")).toBe(true);
    expect(create).toHaveBeenCalledTimes(3);
    expect(maxOpen).toBe(2);
    expect(remove).toHaveBeenCalledTimes(3);
    expect(tabs.size).toBe(0);
  });

  it("rejects a candidate outside the provider before creating a helper", async () => {
    const result = await resolveRendered(
      "netflix",
      page,
      "https://evil.example/title/81726714",
    );
    expect(result.status).toBe("unknown");
    expect(create).not.toHaveBeenCalled();
  });
});
