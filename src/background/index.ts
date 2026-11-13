import { repository } from "../core/repository";
import type { Request } from "../core/client";
import type { Availability, PageTitle } from "../core/types";
import {
  detectProvider,
  providers,
  providerTitleId,
  safeProviderUrl,
} from "../providers/identity";
import { searchProvider } from "../providers/search";
import {
  invalidateResolutions,
  openResolved,
  resolveProvider,
  resetResolutions,
} from "./resolution";

const lookupCache = new Map<string, { at: number; results: Availability[] }>();
const pending = new Map<string, Promise<Availability[]>>();
let cacheGeneration = 0;
const isInternal = (sender: chrome.runtime.MessageSender) =>
  sender.id === chrome.runtime.id &&
  !!sender.url?.startsWith(chrome.runtime.getURL(""));

function validatePage(value: unknown): PageTitle {
  const page = value as PageTitle;
  if (
    !page ||
    typeof page !== "object" ||
    !providers.some((p) => p.id === page.provider) ||
    typeof page.title !== "string" ||
    !page.title.trim() ||
    page.title.length > 500 ||
    typeof page.url !== "string" ||
    !safeProviderUrl(page.provider, page.url) ||
    typeof page.description !== "string" ||
    page.description.length > 20000 ||
    typeof page.imageUrl !== "string" ||
    page.imageUrl.length > 4096 ||
    !Array.isArray(page.aliases) ||
    page.aliases.length > 30 ||
    page.aliases.some((a) => typeof a !== "string" || a.length > 500)
  ) {
    throw new Error(
      "올바른 OTT 작품 정보가 아닙니다. 작품 상세 페이지에서 다시 시도해 주세요.",
    );
  }
  return page;
}

async function lookup(page: PageTitle, force = false): Promise<Availability[]> {
  validatePage(page);
  const key = JSON.stringify([
    page.provider,
    page.url,
    page.title,
    page.year,
    page.aliases,
  ]);
  const cached = lookupCache.get(key);
  if (!force && cached && Date.now() - cached.at < 30 * 60 * 1000)
    return cached.results;
  const pendingKey = `${cacheGeneration}:${key}`;
  if (pending.has(pendingKey)) return pending.get(pendingKey)!;
  const task = (async () => {
    const generation = cacheGeneration;
    const snapshot = await repository.snapshot();
    const saved = snapshot.bookmarks.find(
      (b) =>
        !b.deletedAt &&
        Object.values(b.links).some(
          (l) =>
            l?.provider === page.provider &&
            providerTitleId(l.url) === providerTitleId(page.url),
        ),
    );
    const queryPage = saved
      ? {
          ...page,
          aliases: [
            ...new Set([...page.aliases, ...saved.aliases, saved.title]),
          ].slice(0, 30),
          year: saved.year ?? page.year,
        }
      : page;
    const results = await Promise.all(
      providers.map(async (provider) => {
        const known = saved?.links[provider.id];
        if (provider.id === page.provider)
          return {
            provider: provider.id,
            status: "available",
            url: page.url,
            title: page.title,
            checkedAt: Date.now(),
            reason: "현재 작품 페이지",
          } satisfies Availability;
        if (!force && known && safeProviderUrl(provider.id, known.url))
          return {
            provider: provider.id,
            status: "available",
            url: known.url,
            title: known.title,
            checkedAt: known.verifiedAt,
            reason:
              "보관함에 저장된 연결 · 현재 제공 여부는 서비스에서 확인해 주세요.",
          } satisfies Availability;
        try {
          return await searchProvider(provider.id, queryPage);
        } catch {
          return {
            provider: provider.id,
            status: "unknown",
            checkedAt: Date.now(),
            reason:
              "일시적으로 검색하지 못했습니다. 직접 검색하거나 다시 시도해 주세요.",
          } satisfies Availability;
        }
      }),
    );
    if (generation === cacheGeneration)
      lookupCache.set(key, { at: Date.now(), results });
    if (lookupCache.size > 100)
      lookupCache.delete(lookupCache.keys().next().value!);
    return results;
  })();
  pending.set(pendingKey, task);
  try {
    return await task;
  } finally {
    pending.delete(pendingKey);
  }
}

function resetSearchCaches() {
  resetResolutions();
  cacheGeneration++;
  lookupCache.clear();
  pending.clear();
}

async function notifyChanged(searchReset = false) {
  invalidateResolutions();
  cacheGeneration++;
  lookupCache.clear();
  const events = searchReset
    ? ["search-results-cleared", "changed"]
    : ["changed"];
  for (const event of events)
    await chrome.runtime
      .sendMessage({ channel: "ott-switch", event })
      .catch(() => {});
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs
      .filter((t) => t.id && t.url && detectProvider(t.url))
      .map(async (t) => {
        for (const event of events)
          await chrome.tabs
            .sendMessage(t.id!, { channel: "ott-switch", event })
            .catch(() => {});
      }),
  );
}

async function handle(
  request: Request,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  if (!Array.isArray(request.args) || sender.id !== chrome.runtime.id)
    throw new Error("허용되지 않은 요청입니다.");
  if (!isInternal(sender) && (!sender.url || !detectProvider(sender.url)))
    throw new Error("지원하지 않는 페이지입니다.");
  if (
    !isInternal(sender) &&
    [
      "importBackup",
      "exportBackup",
      "deleteCategory",
      "updateSettings",
      "deleteBookmark",
    ].includes(request.action)
  )
    throw new Error("보관함에서 사용할 수 있는 기능입니다.");
  switch (request.action) {
    case "snapshot":
      return repository.snapshot();
    case "saveBookmark":
      validatePage(request.args[0]?.page);
      return repository.saveBookmark(...request.args);
    case "updateBookmark":
      return repository.updateBookmark(...request.args);
    case "deleteBookmark":
      return repository.deleteBookmark(...request.args);
    case "clearSearchResults": {
      if (request.args.length)
        throw new Error("검색 결과 초기화 요청이 올바르지 않습니다.");
      resetSearchCaches();
      try {
        return await repository.clearSearchResults();
      } finally {
        resetSearchCaches();
      }
    }
    case "saveCategory":
      return repository.saveCategory(
        request.args[0],
        request.args[1] ?? undefined,
        request.args[2] ?? undefined,
      );
    case "deleteCategory":
      return repository.deleteCategory(...request.args);
    case "updateSettings":
      return repository.updateSettings(...request.args);
    case "exportBackup":
      return repository.exportBackup(...request.args);
    case "importBackup":
      return repository.importBackup(...request.args);
    case "lookup":
      return lookup(...request.args);
    case "resolveProvider": {
      validatePage(request.args[0]);
      if (!providers.some((p) => p.id === request.args[1]))
        throw new Error("지원하지 않는 OTT입니다.");
      return resolveProvider(...request.args);
    }
    case "openResolved": {
      validatePage(request.args[0]);
      if (
        !providers.some((p) => p.id === request.args[1]) ||
        (request.args[2] !== undefined &&
          (typeof request.args[2] !== "string" ||
            !safeProviderUrl(request.args[1], request.args[2])))
      )
        throw new Error("올바른 OTT 작품 주소가 아닙니다.");
      return openResolved(
        request.args[0],
        request.args[1],
        request.args[2],
        sender,
      );
    }
    case "openLibrary":
      await chrome.tabs.create({ url: chrome.runtime.getURL("library.html") });
      return;
    default:
      throw new Error("지원하지 않는 요청입니다.");
  }
}

chrome.runtime.onMessage.addListener((request: Request, sender, reply) => {
  if (request?.channel !== "ott-switch" || !("action" in request)) return;
  handle(request, sender)
    .then(async (data) => {
      if (request.action === "clearSearchResults") {
        await notifyChanged(true);
        reply({ ok: true, data });
        return;
      }
      reply({ ok: true, data });
      if (
        ![
          "snapshot",
          "exportBackup",
          "lookup",
          "openLibrary",
          "resolveProvider",
          "openResolved",
        ].includes(request.action)
      )
        await notifyChanged();
    })
    .catch((error) =>
      reply({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "작업을 완료하지 못했습니다.",
      }),
    );
  return true;
});
chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("library.html") });
});
