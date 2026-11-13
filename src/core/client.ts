import type {
  Availability,
  BackupEnvelope,
  Bookmark,
  BookmarkPatch,
  Category,
  LibrarySnapshot,
  PageTitle,
  SaveBookmarkInput,
  Settings,
} from "./types";

export interface ApiMethods {
  snapshot: { args: []; result: LibrarySnapshot };
  saveBookmark: { args: [SaveBookmarkInput]; result: Bookmark };
  updateBookmark: { args: [string, BookmarkPatch]; result: Bookmark };
  deleteBookmark: { args: [string]; result: void };
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
    action as Exclude<Action, "lookup" | "openLibrary">
  ] as (...values: unknown[]) => Promise<unknown>;
  const data = await fn.apply(repository, args);
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
  lookup: (page: PageTitle, force?: boolean) => call("lookup", page, force),
  openLibrary: () => call("openLibrary"),
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
