import type {
  Availability,
  BackupEnvelope,
  Bookmark,
  BookmarkPatch,
  Category,
  LibrarySnapshot,
  PageTitle,
  ProviderId,
  SaveBookmarkInput,
  Settings,
} from "./types";

export interface ApiMethods {
  snapshot: { args: []; result: LibrarySnapshot };
  saveBookmark: { args: [SaveBookmarkInput]; result: Bookmark };
  updateBookmark: { args: [string, BookmarkPatch]; result: Bookmark };
  deleteBookmark: { args: [string]; result: void };
  clearSearchResults: {
    args: [];
    result: { links: number; bookmarks: number };
  };
  saveCategory: { args: [string, string?, string?]; result: Category };
  deleteCategory: { args: [string]; result: void };
  updateSettings: {
    args: [
      Partial<
        Pick<Settings, "subscribedProviders" | "region" | "openInNewTab">
      >,
    ];
    result: Settings;
  };
  exportBackup: { args: [string[]?]; result: BackupEnvelope };
  importBackup: {
    args: [unknown];
    result: { bookmarks: number; categories: number };
  };
  lookup: { args: [PageTitle, boolean?]; result: Availability[] };
  resolveProvider: {
    args: [PageTitle, ProviderId, boolean?];
    result: Availability;
  };
  openResolved: {
    args: [PageTitle, ProviderId, string?];
    result: Availability;
  };
  openLibrary: { args: []; result: void };
}
export type Action = keyof ApiMethods;
export type Request = {
  [A in Action]: {
    channel: "ott-switch";
    action: A;
    args: ApiMethods[A]["args"];
  };
}[Action];
const previewListeners = new Set<() => void>();
const previewSearchResetListeners = new Set<() => void>();
const isExtension = () => typeof chrome !== "undefined" && !!chrome.runtime?.id;

async function call<A extends Action>(
  action: A,
  ...args: ApiMethods[A]["args"]
): Promise<ApiMethods[A]["result"]> {
  if (isExtension()) {
    // Chrome message transport uses JSON; trailing undefined values otherwise become null.
    const wireArgs = [...args];
    while (wireArgs.length && wireArgs.at(-1) === undefined) wireArgs.pop();
    const response = await chrome.runtime.sendMessage({
      channel: "ott-switch",
      action,
      args: wireArgs,
    });
    if (!response?.ok)
      throw new Error(
        response?.error || "확장 프로그램을 새로고침한 후 다시 시도해 주세요.",
      );
    return response.data;
  }
  // Dev preview uses an isolated localhost IndexedDB, never the extension database.
  if (action === "resolveProvider" || action === "openResolved") {
    return {
      provider: args[1],
      status: "unknown",
      checkedAt: Date.now(),
      reason: "작품 확인과 이동은 설치된 확장 프로그램에서 사용할 수 있습니다.",
    } as ApiMethods[A]["result"];
  }
  if (action === "lookup") {
    const { providers } = await import("../providers/identity");
    return providers.map((p) => ({
      provider: p.id,
      status: "unknown",
      checkedAt: Date.now(),
      reason:
        "미리보기에서는 OTT 자동 조회를 하지 않습니다. 확장 프로그램에서 확인해 주세요.",
    })) as ApiMethods[A]["result"];
  }
  if (action === "openLibrary") return undefined as ApiMethods[A]["result"];
  const { repository } = await import("./repository");
  const fn = repository[
    action as Exclude<
      Action,
      "lookup" | "openLibrary" | "resolveProvider" | "openResolved"
    >
  ] as (...values: unknown[]) => Promise<unknown>;
  const data = await fn.apply(repository, args);
  if (action === "clearSearchResults")
    previewSearchResetListeners.forEach((listener) => listener());
  if (!["snapshot", "exportBackup"].includes(action))
    previewListeners.forEach((listener) => listener());
  return data as ApiMethods[A]["result"];
}

export const api = {
  snapshot: () => call("snapshot"),
  saveBookmark: (input: SaveBookmarkInput) => call("saveBookmark", input),
  updateBookmark: (id: string, patch: BookmarkPatch) =>
    call("updateBookmark", id, patch),
  deleteBookmark: (id: string) => call("deleteBookmark", id),
  clearSearchResults: () => call("clearSearchResults"),
  saveCategory: (name: string, color?: string, id?: string) =>
    call("saveCategory", name, color, id),
  deleteCategory: (id: string) => call("deleteCategory", id),
  updateSettings: (
    patch: Partial<
      Pick<Settings, "subscribedProviders" | "region" | "openInNewTab">
    >,
  ) => call("updateSettings", patch),
  exportBackup: (categoryIds?: string[]) => call("exportBackup", categoryIds),
  importBackup: (raw: unknown) => call("importBackup", raw),
  async lookup(
    page: PageTitle,
    force?: boolean,
    onProgress?: (result: Availability) => void,
  ): Promise<Availability[]> {
    const { providers } = await import("../providers/identity");
    return Promise.all(
      providers.map(async (provider) => {
        const result = await call("resolveProvider", page, provider.id, force);
        onProgress?.(result);
        return result;
      }),
    );
  },
  openResolved: (
    page: PageTitle,
    provider: ProviderId,
    candidateUrl?: string,
  ) => call("openResolved", page, provider, candidateUrl),
  openLibrary: () => call("openLibrary"),
  subscribeSearchResultsCleared(listener: () => void) {
    if (!isExtension()) {
      previewSearchResetListeners.add(listener);
      return () => {
        previewSearchResetListeners.delete(listener);
      };
    }
    const handler = (message: { channel?: string; event?: string }) => {
      if (
        message?.channel === "ott-switch" &&
        message.event === "search-results-cleared"
      )
        listener();
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  },
  subscribe(listener: () => void) {
    if (!isExtension()) {
      previewListeners.add(listener);
      return () => {
        previewListeners.delete(listener);
      };
    }
    const handler = (message: { channel?: string; event?: string }) => {
      if (message?.channel === "ott-switch" && message.event === "changed")
        listener();
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  },
};
