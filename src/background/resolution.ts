import { repository } from "../core/repository";
import type { Availability, PageTitle, ProviderId } from "../core/types";
import {
  cleanSearchPage,
  normalizeTitle,
  titleVariants,
  providerTitleId,
  safeProviderUrl,
} from "../providers/identity";
import { readDetailPage, searchProvider } from "../providers/search";
import { resolveRendered } from "./rendered-search";

const cache = new Map<
  string,
  { result: Availability; browserAttempted: boolean }
>();
const pending = new Map<string, Promise<Availability>>();
let generation = 0;
let resetGeneration = 0;
const refreshedSources = new Map<
  string,
  { at: number; task: Promise<PageTitle | null> }
>();
export function invalidateResolutions() {
  generation++;
  cache.clear();
}

export function resetResolutions() {
  resetGeneration++;
  invalidateResolutions();
  pending.clear();
  refreshedSources.clear();
}

const resetResult = (provider: ProviderId): Availability => ({
  provider,
  status: "unknown",
  checkedAt: Date.now(),
  reason:
    "검색 결과가 초기화되어 이전 검색을 취소했습니다. 다시 검색해 주세요.",
});

async function prepareQuery(
  page: PageTitle,
  aliases: string[] = page.aliases,
): Promise<PageTitle> {
  page = cleanSearchPage(page);
  let refreshed: PageTitle | null = null;
  if (
    /^\s*Watch\s+/i.test(page.title) &&
    ["netflix", "crunchyroll", "prime"].includes(page.provider)
  ) {
    const stored = refreshedSources.get(page.url);
    const task =
      stored && Date.now() - stored.at < 5 * 60_000
        ? stored.task
        : readDetailPage(page.provider, page.url);
    if (!stored || task !== stored.task)
      refreshedSources.set(page.url, { at: Date.now(), task });
    if (refreshedSources.size > 50)
      refreshedSources.delete(refreshedSources.keys().next().value!);
    refreshed = await task;
    // A 200 response at the same URL may be a home/login shell or a different
    // hydrated work. Refresh can remove a CTA, not replace the user's identity.
    const expected = new Set(
      [page.title, ...page.aliases]
        .flatMap(titleVariants)
        .flatMap((title) => [title, title.replace(/^Watch\s+/i, "")])
        .map(normalizeTitle),
    );
    if (
      refreshed &&
      (!expected.has(normalizeTitle(refreshed.title)) ||
        (page.year && refreshed.year && page.year !== refreshed.year))
    )
      refreshed = null;
  }
  return cleanSearchPage(
    {
      ...page,
      title: refreshed?.title || page.title,
      aliases: [...aliases, ...(refreshed?.aliases || [])],
      year: page.year ?? refreshed?.year,
    },
    refreshed ? [refreshed.title, ...refreshed.aliases] : [],
  );
}

export async function resolveProvider(
  page: PageTitle,
  provider: ProviderId,
  force = false,
  explicit = false,
): Promise<Availability> {
  const revision = generation;
  const reset = resetGeneration;
  const snapshot = await repository.snapshot();
  if (reset !== resetGeneration) return resetResult(provider);
  const saved = snapshot.bookmarks.find(
    (b) =>
      !b.deletedAt &&
      Object.values(b.links).some(
        (link) =>
          link?.provider === page.provider &&
          providerTitleId(link.url) === providerTitleId(page.url),
      ),
  );
  const aliases = [
    ...new Set([
      ...page.aliases,
      ...(saved?.aliases || []),
      ...(saved ? [saved.title] : []),
    ]),
  ].slice(0, 30);
  const query = await prepareQuery(
    { ...page, year: saved?.year ?? page.year },
    aliases,
  );
  if (reset !== resetGeneration) return resetResult(provider);
  if (provider === page.provider)
    return {
      provider,
      status: "available",
      checkedAt: Date.now(),
      url: page.url,
      title: query.title,
      reason: "현재 작품 페이지",
    };
  const known = saved?.links[provider];
  if (!force && known && safeProviderUrl(provider, known.url))
    return {
      provider,
      status: "available",
      checkedAt: known.verifiedAt,
      url: known.url,
      title: known.title,
      reason: "보관함에 저장된 작품 연결",
    };
  // Only subscribed services use temporary tabs during automatic discovery. The explicit
  // 'find and switch' action can verify any selected provider without opening ten tabs at once.
  const allowBrowser =
    explicit || snapshot.settings.subscribedProviders.includes(provider);
  const key = JSON.stringify([
    provider,
    query.title,
    query.aliases,
    query.year,
  ]);
  const stored = cache.get(key);
  if (
    !force &&
    stored &&
    Date.now() - stored.result.checkedAt <
      (stored.result.status === "unknown" ? 60_000 : 30 * 60_000) &&
    (stored.result.status !== "unknown" ||
      !allowBrowser ||
      stored.browserAttempted)
  )
    return stored.result;
  const pendingKey = JSON.stringify([revision, key, allowBrowser]);
  if (pending.has(pendingKey)) return pending.get(pendingKey)!;
  const task = (async () => {
    let result: Availability;
    try {
      result = await searchProvider(provider, query);
    } catch {
      result = {
        provider,
        status: "unknown",
        checkedAt: Date.now(),
        reason: "공개 검색 응답을 읽지 못했습니다.",
      };
    }
    const browserAttempted = result.status === "unknown" && allowBrowser;
    if (reset !== resetGeneration) return resetResult(provider);
    if (browserAttempted) result = await resolveRendered(provider, query);
    if (reset !== resetGeneration) return resetResult(provider);
    if (revision === generation) {
      cache.set(key, { result, browserAttempted });
      if (cache.size > 150) cache.delete(cache.keys().next().value!);
    }
    return result;
  })();
  pending.set(pendingKey, task);
  try {
    return await task;
  } finally {
    pending.delete(pendingKey);
  }
}

export async function openResolved(
  page: PageTitle,
  provider: ProviderId,
  candidateUrl: string | undefined,
  sender: chrome.runtime.MessageSender,
): Promise<Availability> {
  const reset = resetGeneration;
  // Candidate URLs from the UI are untrusted until the target's rendered metadata agrees.
  const snapshot = await repository.snapshot();
  if (reset !== resetGeneration) return resetResult(provider);
  const saved = snapshot.bookmarks.find(
    (b) =>
      !b.deletedAt &&
      Object.values(b.links).some(
        (link) =>
          link?.provider === page.provider &&
          providerTitleId(link.url) === providerTitleId(page.url),
      ),
  );
  const query = await prepareQuery(
    { ...page, year: saved?.year ?? page.year },
    [
      ...new Set([
        ...page.aliases,
        ...(saved?.aliases || []),
        ...(saved ? [saved.title] : []),
      ]),
    ].slice(0, 30),
  );
  if (reset !== resetGeneration) return resetResult(provider);
  const result = candidateUrl
    ? await resolveRendered(provider, query, candidateUrl)
    : await resolveProvider(query, provider, false, true);
  if (reset !== resetGeneration) return resetResult(provider);
  if (
    result.status !== "available" ||
    !result.url ||
    !safeProviderUrl(provider, result.url)
  )
    return result;
  const { settings } = await repository.snapshot();
  if (reset !== resetGeneration) return resetResult(provider);
  if (settings.openInNewTab || !sender.tab?.id)
    await chrome.tabs.create({ url: result.url, active: true });
  else {
    const source = await chrome.tabs.get(sender.tab.id);
    if (reset !== resetGeneration) return resetResult(provider);
    // Do not replace a tab the user has navigated elsewhere while verification was running.
    if (source.url !== sender.url)
      return {
        ...result,
        opened: false,
        reason:
          "작품을 확인했습니다. 원래 탭이 이동되어 자동 이동은 취소했어요. 스위치를 눌러 열어 주세요.",
      };
    await chrome.tabs.update(sender.tab.id, { url: result.url });
  }
  return {
    ...result,
    opened: true,
    reason: "제목이 일치하는 작품 상세 페이지로 이동했습니다.",
  };
}
