import type { Availability, PageTitle, ProviderId } from "../core/types";
import type { ProbeReply, ProbeRequest } from "../core/probe";
import type { SearchAction } from "../providers/search-actions";
import {
  canonicalizeProviderUrl,
  cleanSearchTitle,
  cleanSearchPage,
  normalizeTitle,
  titleVariants,
  detectProvider,
  providers,
  providerTitleId,
  safeProviderUrl,
} from "../providers/identity";
import { isSearchUrl } from "../providers/search-results";
import { matchCandidates } from "../providers/search";

const SEARCH_TIMEOUT = 14_000;
const DETAIL_TIMEOUT = 10_000;
const STABLE_MS = 900;
const POLL_MS = 350;
const MAX_CONCURRENT = 2;
let active = 0;
const waiters: (() => void)[] = [];

const unknown = (provider: ProviderId, reason: string): Availability => ({
  provider,
  status: "unknown",
  checkedAt: Date.now(),
  reason,
});
const pause = () =>
  new Promise<void>((resolve) => setTimeout(resolve, POLL_MS));

async function withSlot<T>(task: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT)
    await new Promise<void>((resolve) => waiters.push(resolve));
  else active++;
  try {
    return await task();
  } finally {
    const next = waiters.shift();
    if (next) next();
    else active--;
  }
}

interface OwnedTab {
  id: number;
  token: string;
  relinquished: boolean;
  expectedUrl: string;
  previousUrl?: string;
  authRedirect?: string;
  actionNavigation?: { from: string; deadline: number };
}

/** Normal site navigation uses the user's existing login session; no cookies or tokens are read. */
export async function resolveRendered(
  provider: ProviderId,
  page: PageTitle,
  candidateUrl?: string,
): Promise<Availability> {
  page = cleanSearchPage(page);
  if (!page.title)
    return unknown(provider, "검색할 작품 제목을 확인하지 못했습니다.");
  const definition = providers.find((p) => p.id === provider);
  if (!definition || (candidateUrl && !safeProviderUrl(provider, candidateUrl)))
    return unknown(provider, "올바른 작품 주소가 아닙니다.");
  return withSlot(async () => {
    let owned: OwnedTab | undefined;
    const activationDuringCreate = new Set<number>();
    const redirectsDuringCreate: { id: number; url: string }[] = [];
    const activated = (info: { tabId: number }) => {
      if (!owned) activationDuringCreate.add(info.tabId);
      else if (info.tabId === owned.id) owned.relinquished = true;
    };
    const removed = (id: number) => {
      if (owned && id === owned.id) owned.relinquished = true;
    };
    const updated = (id: number, change: { url?: string }) => {
      if (!change.url) return;
      if (!owned) {
        if (redirectsDuringCreate.length < 100)
          redirectsDuringCreate.push({ id, url: change.url });
        return;
      }
      if (id !== owned.id) return;
      if (acceptActionDestination(owned, change.url, provider)) return;
      // A tab that leaves the requested search/detail route is no longer ours to navigate or close.
      if (!sameDestination(change.url, owned.expectedUrl, provider)) {
        if (!owned.relinquished && isAuthRedirect(change.url, provider))
          owned.authRedirect = change.url;
        else owned.relinquished = true;
      }
    };
    try {
      const firstUrl =
        candidateUrl ||
        definition.searchUrl(
          cleanSearchTitle(page.title, page.provider, page.aliases),
        );
      chrome.tabs.onActivated.addListener(activated);
      chrome.tabs.onRemoved.addListener(removed);
      chrome.tabs.onUpdated.addListener(updated);
      const tab = await chrome.tabs.create({ url: firstUrl, active: false });
      if (!tab.id) return unknown(provider, "검색 화면을 열지 못했습니다.");
      owned = {
        id: tab.id,
        token: crypto.randomUUID(),
        relinquished: tab.active || activationDuringCreate.has(tab.id),
        expectedUrl: firstUrl,
      };
      for (const event of redirectsDuringCreate)
        updated(event.id, { url: event.url });
      // Avoid audio from autoplay previews in temporary verification tabs.
      if (!owned.relinquished)
        await chrome.tabs.update(owned.id, { muted: true });
      if (candidateUrl)
        return await verifyDetail(owned, provider, page, candidateUrl);
      const queries = [
        ...new Set(
          [page.title, ...page.aliases]
            .map((title) =>
              cleanSearchTitle(title, page.provider, page.aliases),
            )
            .filter(Boolean),
        ),
      ].slice(0, 2);
      let last = unknown(
        provider,
        "검색 결과가 준비되지 않았습니다. 로그인 상태를 확인하고 다시 시도해 주세요.",
      );
      for (let index = 0; index < queries.length; index++) {
        if (index)
          await navigate(owned, definition.searchUrl(queries[index]), provider);
        const search = await collect(owned, provider, "search", SEARCH_TIMEOUT);
        if (search.blocked)
          return unknown(
            provider,
            search.reason || "서비스에서 로그인 또는 접근 확인이 필요합니다.",
          );
        if (!isSearchUrl(provider, search.url))
          return unknown(
            provider,
            "검색 페이지를 확인하지 못했습니다. 서비스 로그인 상태를 확인해 주세요.",
          );
        last = matchCandidates(
          provider,
          page,
          search.candidates || [],
          search.complete === true,
        );
        const wanted = new Set(
          [page.title, ...page.aliases]
            .flatMap(titleVariants)
            .map(normalizeTitle),
        );
        const actions = (search.actions || []).filter((action) =>
          titleVariants(action.title).some((title) =>
            wanted.has(normalizeTitle(title)),
          ),
        );
        if (last.status === "available" && last.url && !actions.length)
          return await verifyDetail(owned, provider, page, last.url);
        if (last.status === "ambiguous") return last;
        if (actions.length) {
          if (actions.length !== 1 || last.status === "available")
            return unknown(
              provider,
              "같은 제목의 검색 카드가 여러 개입니다. 공식 검색에서 작품을 선택해 주세요.",
            );
          return await activateAndVerify(owned, provider, page, actions[0]);
        }
      }
      return last;
    } catch (error) {
      return unknown(
        provider,
        error instanceof Error
          ? error.message
          : "브라우저에서 작품을 확인하지 못했습니다.",
      );
    } finally {
      try {
        if (owned && !owned.relinquished) {
          try {
            const tab = await chrome.tabs.get(owned.id);
            const allowed = (url: string) =>
              sameDestination(url, owned!.expectedUrl, provider) ||
              url === owned!.authRedirect;
            const ownedPendingBlank =
              tab.url === "about:blank" &&
              tab.status === "loading" &&
              !!tab.pendingUrl &&
              allowed(tab.pendingUrl);
            const ownedPendingPrevious =
              tab.url === owned.previousUrl &&
              tab.status === "loading" &&
              !!tab.pendingUrl &&
              allowed(tab.pendingUrl);
            if (
              !owned.relinquished &&
              !tab.active &&
              tab.url &&
              (allowed(tab.url) || ownedPendingBlank || ownedPendingPrevious) &&
              (!tab.pendingUrl || allowed(tab.pendingUrl))
            )
              await chrome.tabs.remove(owned.id);
          } catch {
            /* Already closed by the user/browser. */
          }
        }
      } finally {
        chrome.tabs.onActivated.removeListener(activated);
        chrome.tabs.onRemoved.removeListener(removed);
        chrome.tabs.onUpdated.removeListener(updated);
      }
    }
  });
}

function isAuthRedirect(url: string, provider: ProviderId): boolean {
  return (
    detectProvider(url) === provider &&
    /\/(?:login|signin|sign-in|sign_in|auth-redirect|unsupported-browser)(?:\/|$)/i.test(
      new URL(url).pathname,
    )
  );
}

function sameDestination(
  actual: string,
  expected: string,
  provider: ProviderId,
): boolean {
  if (detectProvider(actual) !== provider) return false;
  if (safeProviderUrl(provider, expected))
    return (
      safeProviderUrl(provider, actual) &&
      providerTitleId(actual) === providerTitleId(expected)
    );
  if (!isSearchUrl(provider, actual) || !isSearchUrl(provider, expected))
    return false;
  const a = new URL(actual),
    b = new URL(expected);
  // Retain the search term even if the service adds tracking or normalizes its path.
  return [...b.searchParams.entries()].every(
    ([key, value]) => a.searchParams.get(key) === value,
  );
}

function acceptActionDestination(
  tab: OwnedTab,
  url: string,
  provider: ProviderId,
): boolean {
  if (
    !tab.relinquished &&
    tab.actionNavigation &&
    Date.now() < tab.actionNavigation.deadline &&
    sameDestination(tab.expectedUrl, tab.actionNavigation.from, provider) &&
    safeProviderUrl(provider, url)
  ) {
    tab.previousUrl = tab.expectedUrl;
    tab.expectedUrl = url;
    tab.actionNavigation = undefined;
    return true;
  }
  return false;
}

async function ensureOwned(tab: OwnedTab, provider: ProviderId) {
  const current = await chrome.tabs.get(tab.id);
  if (!current.active && !tab.relinquished && current.url)
    acceptActionDestination(tab, current.url, provider);
  if (!current.active && !tab.relinquished && current.pendingUrl)
    acceptActionDestination(tab, current.pendingUrl, provider);
  if (!tab.relinquished && !current.active) {
    const auth = [current.url, current.pendingUrl].find(
      (url) => url && isAuthRedirect(url, provider),
    );
    if (auth) tab.authRedirect = auth;
  }
  if (tab.authRedirect && !tab.relinquished && !current.active)
    throw new Error(
      "서비스에서 로그인 또는 접근 확인이 필요합니다. 로그인 후 다시 시도해 주세요.",
    );
  if (
    current.active ||
    (current.url &&
      !sameDestination(current.url, tab.expectedUrl, provider) &&
      current.status !== "loading") ||
    (current.pendingUrl &&
      !sameDestination(current.pendingUrl, tab.expectedUrl, provider))
  )
    tab.relinquished = true;
  if (tab.relinquished)
    throw new Error(
      "검색 확인이 중단되었습니다. 사용자가 선택하거나 이동한 탭은 그대로 유지합니다.",
    );
}

async function navigate(tab: OwnedTab, url: string, provider: ProviderId) {
  await ensureOwned(tab, provider);
  tab.previousUrl = tab.expectedUrl;
  tab.expectedUrl = url;
  await chrome.tabs.update(tab.id, { url, active: false });
}

async function collect(
  tab: OwnedTab,
  provider: ProviderId,
  kind: "search" | "detail",
  timeout: number,
): Promise<ProbeReply> {
  const deadline = Date.now() + timeout;
  let stable = "",
    stableSince = Date.now();
  let last: ProbeReply = {
    token: tab.token,
    url: tab.expectedUrl,
    ready: false,
  };
  while (Date.now() < deadline) {
    await ensureOwned(tab, provider);
    let next: ProbeReply | undefined;
    try {
      next = await chrome.tabs.sendMessage(
        tab.id,
        {
          channel: "ott-switch-probe",
          token: tab.token,
          provider,
          kind,
        } satisfies ProbeRequest,
        { frameId: 0 },
      );
    } catch {
      /* Content script is not loaded yet. */
    }
    if (
      next?.token === tab.token &&
      sameDestination(next.url, tab.expectedUrl, provider)
    ) {
      last = next;
      const signature = JSON.stringify([
        next.detail,
        next.candidates,
        next.actions,
        next.complete,
        next.blocked,
        next.loading,
      ]);
      if (signature !== stable) {
        stable = signature;
        stableSince = Date.now();
      }
      if (next.blocked) return next;
      if (
        next.ready &&
        !next.loading &&
        Date.now() - stableSince >= STABLE_MS &&
        (next.detail ||
          next.candidates?.length ||
          next.actions?.length ||
          next.complete)
      )
        return next;
    }
    await pause();
  }
  // A half-rendered search must never enable an arbitrary first exact match.
  if (kind === "search")
    return {
      ...last,
      candidates: [],
      actions: [],
      complete: false,
      reason: "검색 결과를 끝까지 확인하지 못했습니다.",
    };
  return { ...last, detail: null };
}

async function activateAndVerify(
  tab: OwnedTab,
  provider: ProviderId,
  page: PageTitle,
  action: SearchAction,
): Promise<Availability> {
  await ensureOwned(tab, provider);
  tab.actionNavigation = {
    from: tab.expectedUrl,
    deadline: Date.now() + DETAIL_TIMEOUT,
  };
  const deadline = tab.actionNavigation.deadline;
  try {
    let reply: ProbeReply | undefined;
    try {
      reply = await chrome.tabs.sendMessage(
        tab.id,
        {
          channel: "ott-switch-probe",
          token: tab.token,
          provider,
          kind: "activate-search",
          action,
        } satisfies ProbeRequest,
        { frameId: 0 },
      );
    } catch {
      /* A full document navigation can close the message port. */
    }
    if (reply && (reply.token !== tab.token || reply.activated !== true))
      return unknown(
        provider,
        "검색 결과가 바뀌었거나 탭이 선택되어 작품 확인을 중단했습니다.",
      );
    while (Date.now() < deadline) {
      await ensureOwned(tab, provider);
      if (!tab.actionNavigation && safeProviderUrl(provider, tab.expectedUrl))
        return await verifyDetail(tab, provider, page, tab.expectedUrl);
      await pause();
    }
    return unknown(provider, "검색 카드의 작품 주소를 확인하지 못했습니다.");
  } finally {
    tab.actionNavigation = undefined;
  }
}

async function verifyDetail(
  tab: OwnedTab,
  provider: ProviderId,
  page: PageTitle,
  url: string,
): Promise<Availability> {
  if (!sameDestination(tab.expectedUrl, url, provider))
    await navigate(tab, url, provider);
  const probe = await collect(tab, provider, "detail", DETAIL_TIMEOUT);
  const detail = probe.detail;
  if (
    !detail ||
    !safeProviderUrl(provider, detail.url) ||
    providerTitleId(detail.url) !== providerTitleId(url)
  )
    return unknown(
      provider,
      "검색 후보의 작품 상세 정보를 확인하지 못했습니다.",
    );
  const result = matchCandidates(
    provider,
    page,
    [{ title: detail.title, url: detail.url, year: detail.year }],
    false,
  );
  return result.status === "available"
    ? {
        ...result,
        url: canonicalizeProviderUrl(detail.url)!,
        reason: "브라우저 검색 결과와 작품 상세 제목의 일치를 확인했습니다.",
      }
    : unknown(
        provider,
        "검색 결과와 상세 작품의 제목·연도가 다릅니다. 자동으로 이동하지 않았습니다.",
      );
}
