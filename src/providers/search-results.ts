import type { ProviderId } from "../core/types";
import type { SearchCandidate } from "./search";
import { readSearchActions, type SearchAction } from "./search-actions";
import {
  canonicalizeProviderUrl,
  cleanPageTitle,
  cleanTitle,
  detectProvider,
  providerTitleId,
  safeProviderUrl,
} from "./identity";

export interface RenderedSearchResults {
  candidates: SearchCandidate[];
  actions?: SearchAction[];
  /** Only explicit no-result evidence is exhaustive; a visible subset is not. */
  complete: boolean;
  loading?: boolean;
  reason?: string;
  blocked?: boolean;
}

const searchPaths: Record<ProviderId, RegExp> = {
  laftel: /^\/search\/?$/i,
  aniplus: /^\/search\/?$/i,
  crunchyroll: /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?search\/?$/i,
  netflix: /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?search\/?$/i,
  prime: /^\/(?:-\/[a-z]{2}\/)?search(?:\/ref=[^/]+)?\/?$/i,
  apple: /^\/[a-z]{2}\/search\/?$/i,
  wavve: /^\/search(?:\.html)?\/?$/i,
  tving: /^\/search\/?$/i,
  coupang: /^\/search\/?$/i,
  watcha: /^\/(?:[a-z]{2}\/)?search\/?$/i,
};
const queryKeys: Record<ProviderId, string[]> = {
  laftel: ["keyword"],
  aniplus: ["st"],
  crunchyroll: ["q"],
  netflix: ["q"],
  prime: ["phrase"],
  apple: ["term"],
  wavve: ["searchWord"],
  tving: ["keyword"],
  coupang: ["q", "query"],
  watcha: ["query"],
};

export function isSearchUrl(provider: ProviderId, value: string): boolean {
  if (detectProvider(value) !== provider) return false;
  const url = new URL(value);
  return (
    searchPaths[provider].test(url.pathname) &&
    !url.searchParams.has("jbv") &&
    !(provider === "laftel" && url.searchParams.has("modal")) &&
    queryKeys[provider].some((key) => !!url.searchParams.get(key)?.trim())
  );
}

const TITLE_SELECTOR = [
  ".search-card-title",
  ".fallback-text",
  ".title-card-title",
  ".card-title",
  '[data-testid="title"]',
  '[data-testid="title-text"]',
  '[data-uia="title-card-title"]',
  '[data-test="title"]',
  "h2",
  "h3",
  "h4",
].join(",");
const CARD_SELECTOR = [
  ".title-card",
  ".title-card-container",
  ".search-card",
  ".search-result",
  ".content-card",
  '[data-uia="title-card-container"]',
  '[data-testid="search-card-lockup"]',
  '[data-testid="search-result"]',
  '[data-testid="search-result-card"]',
  '[data-t="search-result"]',
  "li",
  "article",
].join(",");
const EXCLUDED_SELECTOR = [
  "nav",
  "footer",
  '[role="navigation"]',
  '[data-testid*="recommend" i]',
  '[data-uia*="recommend" i]',
  '[class*="recommend" i]',
  '[aria-label*="추천"]',
  ".episodeSelector",
  '[data-uia*="episode" i]',
  '[data-testid*="episode" i]',
].join(",");
const EMPTY_SELECTOR = [
  ".search-page__error-message",
  ".search-no-results",
  ".no-results",
  ".no-result",
  ".empty-results",
  ".search-result-empty",
  ".no-data",
  ".noData",
  ".nodata",
  '[data-testid*="no-result" i]',
  '[data-testid*="empty-result" i]',
  '[data-uia="search-no-results"]',
  '[role="status"]',
  "main p",
  '[role="main"] p',
].join(",");
const EMPTY_TEXT =
  /검색\s*(?:된\s*)?(?:결과|작품|콘텐츠)(?:이|가|는)?\s*(?:없|0\s*개)|일치하는\s*(?:작품|결과|콘텐츠)(?:이|가)?\s*없|no\s+(?:search\s+)?(?:results|matches)(?:\s+(?:were\s+)?found)?|your search.{0,100}(?:did not have any matches|returned no)|we (?:couldn.t|could not) find/i;
const NON_TITLE =
  /^(?:play|watch|watch now|more info|details|episodes?|add to (?:my )?list|재생|시청|지금 시청|상세 ?정보|자세히 보기|찜|에피소드|썸네일|포스터|thumbnail|poster|image|tv|movie|series|new|신작|독점|무료|더보기|[0-9]+(?:세|화|회|분)?)$/i;

function visible(element: Element): boolean {
  if (
    element.closest(
      '[hidden], [aria-hidden="true"], template, script, noscript',
    )
  )
    return false;
  let current: Element | null = element;
  while (current) {
    if (
      /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(
        current.getAttribute("style") ?? "",
      )
    )
      return false;
    const view = current.ownerDocument.defaultView;
    if (view && typeof view.getComputedStyle === "function") {
      const style = view.getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden")
        return false;
    }
    current = current.parentElement;
  }
  return true;
}

function meaningful(value: string): string {
  const result = cleanTitle(value).trim();
  return result && result.length <= 400 && !NON_TITLE.test(result)
    ? result
    : "";
}

interface TitleEvidence {
  title: string;
  score: number;
}
function candidateTitle(
  anchor: Element,
  provider: ProviderId,
): TitleEvidence | null {
  const card = anchor.closest(CARD_SELECTOR);
  const explicit = [...anchor.querySelectorAll(TITLE_SELECTOR)]
    .map((node) => meaningful(node.textContent ?? ""))
    .filter(Boolean);
  const images = [...anchor.querySelectorAll("img[alt]")]
    .map((image) => meaningful(image.getAttribute("alt") ?? ""))
    .filter(Boolean);
  const parentTitles =
    card && card !== anchor
      ? [...card.querySelectorAll(TITLE_SELECTOR)]
          .filter((node) => !node.closest(EXCLUDED_SELECTOR))
          .map((node) => meaningful(node.textContent ?? ""))
          .filter(Boolean)
      : [];
  const references = [...explicit, ...images, ...parentTitles];
  const evidence: TitleEvidence[] = [
    ...explicit.map((title) => ({ title, score: 100 })),
    ...images.map((title) => ({ title, score: 90 })),
    ...parentTitles.map((title) => ({ title, score: 85 })),
  ];
  for (const [attribute, score] of [
    ["aria-label", 75],
    ["title", 70],
  ] as const) {
    const raw = anchor.getAttribute(attribute);
    if (raw) {
      const title = meaningful(
        cleanPageTitle(raw, provider, "label", references),
      );
      if (title) evidence.push({ title, score });
    }
  }
  // The final fallback removes badges before reading text, without changing the page DOM.
  const clone = anchor.cloneNode(true) as Element;
  clone
    .querySelectorAll(
      'svg, [aria-hidden="true"], [class*="badge" i], [class*="rating" i], [class*="metadata" i], time',
    )
    .forEach((node) => node.remove());
  const title = meaningful(clone.textContent ?? "");
  if (title) evidence.push({ title, score: 40 });
  return evidence.sort((a, b) => b.score - a.score)[0] ?? null;
}

function titleUrl(
  anchor: Element,
  provider: ProviderId,
  pageUrl: string,
): string | null {
  let target: URL;
  try {
    target = new URL(
      anchor.getAttribute("href") ?? anchor.getAttribute("data-href") ?? "",
      pageUrl,
    );
  } catch {
    return null;
  }
  if (safeProviderUrl(provider, target.href))
    return canonicalizeProviderUrl(target.href);
  // Netflix cards often expose a play URL. Its video ID is usable as a title ID only
  // for a top-level search-title card; episode/player links elsewhere are excluded.
  if (
    provider === "netflix" &&
    detectProvider(target.href) === provider &&
    anchor.closest(
      '.title-card, .title-card-container, [data-uia="title-card-container"]',
    )
  ) {
    const id = target.pathname.match(/^\/(?:[a-z]{2}\/)?watch\/(\d+)\/?$/)?.[1];
    if (id) return `https://www.netflix.com/title/${id}`;
  }
  return null;
}

function structuredCandidates(
  document: Document,
  provider: ProviderId,
  pageUrl: string,
): SearchCandidate[] {
  const found: SearchCandidate[] = [];
  function visit(value: unknown, depth = 0) {
    if (!value || typeof value !== "object" || depth > 6 || found.length >= 200)
      return;
    if (Array.isArray(value)) {
      value.slice(0, 200).forEach((item) => visit(item, depth + 1));
      return;
    }
    const item = value as Record<string, unknown>;
    const types = Array.isArray(item["@type"])
      ? item["@type"]
      : [item["@type"]];
    if (types.includes("ItemList") && Array.isArray(item.itemListElement)) {
      for (const raw of item.itemListElement.slice(0, 200)) {
        if (!raw || typeof raw !== "object") continue;
        const entry = raw as Record<string, unknown>;
        const content =
          entry.item && typeof entry.item === "object"
            ? (entry.item as Record<string, unknown>)
            : entry;
        if (typeof content.name !== "string" || typeof content.url !== "string")
          continue;
        let url: string;
        try {
          url = new URL(content.url, pageUrl).href;
        } catch {
          continue;
        }
        const title = meaningful(content.name);
        if (!title || !safeProviderUrl(provider, url)) continue;
        const year =
          typeof content.datePublished === "string" &&
          /^\d{4}/.test(content.datePublished)
            ? Number(content.datePublished.slice(0, 4))
            : undefined;
        found.push({
          title,
          url: canonicalizeProviderUrl(url)!,
          ...(year && year >= 1888 && year <= 2200 ? { year } : {}),
        });
      }
    }
    if (item["@graph"]) visit(item["@graph"], depth + 1);
    if (item.mainEntity) visit(item.mainEntity, depth + 1);
  }
  for (const script of document.querySelectorAll(
    'script[type="application/ld+json"]',
  )) {
    const text = script.textContent ?? "";
    if (text.length > 500_000) continue;
    try {
      visit(JSON.parse(text));
    } catch {
      /* Untrusted metadata is never evaluated. */
    }
  }
  return found;
}

/** Reads already-rendered search DOM. This module has no network or parser dependency. */
export function readSearchResults(
  document: Document,
  provider: ProviderId,
  pageUrl: string,
): RenderedSearchResults {
  const pageTitle = document.querySelector("title")?.textContent ?? "";
  const loginHeading = [...document.querySelectorAll("h1, h2")].some(
    (node) =>
      visible(node) &&
      /^(?:로그인|sign in|log in|login|지원하지 않는 브라우저)$/i.test(
        node.textContent?.trim() ?? "",
      ),
  );
  const challenge = document.querySelector(
    '#challenge-running, #challenge-error-text, [data-testid="challenge-page"]',
  );
  if (
    /just a moment|access denied|security verification|unsupported browser|로그인\s*[|–—-]|^sign in\b/i.test(
      pageTitle,
    ) ||
    loginHeading ||
    (challenge && visible(challenge)) ||
    (detectProvider(pageUrl) === provider &&
      /\/(?:login|signin|sign_in|auth-redirect|unsupported-browser)(?:\/|$)/i.test(
        new URL(pageUrl).pathname,
      ))
  ) {
    return {
      candidates: [],
      complete: false,
      blocked: true,
      reason: "로그인 또는 사이트의 접근 확인이 필요합니다.",
    };
  }
  if (!isSearchUrl(provider, pageUrl))
    return {
      candidates: [],
      complete: false,
      reason: "해당 OTT의 검색 결과 화면이 아닙니다.",
    };
  // A completed document may still be hydrating its client-side search grid.
  // Do not certify the first card or stale "no results" while that grid is busy.
  const loading = [
    ...document.querySelectorAll(
      '[aria-busy="true"], main [role="progressbar"], [role="main"] [role="progressbar"], [data-testid="search-loading"], .search-loading, .search-results .loading-spinner',
    ),
  ].some((node) => visible(node) && !node.closest(EXCLUDED_SELECTOR));
  if (loading)
    return {
      candidates: [],
      complete: false,
      loading: true,
      reason: "브라우저가 검색 결과를 불러오는 중입니다.",
    };
  const empty = [...document.querySelectorAll(EMPTY_SELECTOR)].find(
    (node) => visible(node) && EMPTY_TEXT.test(node.textContent?.trim() ?? ""),
  );
  if (empty)
    return {
      candidates: [],
      complete: true,
      reason: "공식 검색 화면에 검색 결과 없음이 표시되었습니다.",
    };

  const deduplicated = new Map<string, SearchCandidate & { score: number }>();
  const add = (candidate: SearchCandidate, score: number) => {
    const id = providerTitleId(candidate.url);
    if (!id) return;
    const previous = deduplicated.get(id);
    if (!previous || score > previous.score)
      deduplicated.set(id, { ...candidate, score });
  };
  for (const anchor of document.querySelectorAll(
    'a[href], [role="link"][data-href]',
  )) {
    if (deduplicated.size >= 200) break;
    if (!visible(anchor) || anchor.closest(EXCLUDED_SELECTOR)) continue;
    const url = titleUrl(anchor, provider, pageUrl);
    if (!url) continue;
    const title = candidateTitle(anchor, provider);
    if (title) add({ title: title.title, url }, title.score);
  }
  for (const candidate of structuredCandidates(document, provider, pageUrl))
    add(candidate, 80);
  const candidates = [...deduplicated.values()].map(
    ({ score: _score, ...candidate }) => candidate,
  );
  const actions = readSearchActions(document, provider, pageUrl);
  return {
    candidates,
    ...(actions.length ? { actions } : {}),
    complete: false,
    ...(candidates.length || actions.length
      ? {}
      : {
          reason:
            "검색 결과를 불러오는 중이거나 작품 링크를 확인할 수 없습니다.",
        }),
  };
}
