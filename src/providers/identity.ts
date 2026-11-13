import type { ProviderDefinition, ProviderId } from "../core/types";

export const providers: ProviderDefinition[] = [
  {
    id: "laftel",
    name: "라프텔",
    color: "#a78bfa",
    searchUrl: (title) =>
      `https://laftel.net/search?keyword=${encodeURIComponent(cleanSearchTitle(title))}`,
  },
  {
    id: "aniplus",
    name: "애니플러스",
    color: "#ef4b35",
    searchUrl: (title) =>
      `https://www.aniplustv.com/Search?st=${encodeURIComponent(cleanSearchTitle(title))}`,
  },
  {
    id: "crunchyroll",
    name: "Crunchyroll",
    color: "#ff640a",
    searchUrl: (title) =>
      `https://www.crunchyroll.com/search?q=${encodeURIComponent(cleanSearchTitle(title))}`,
  },
  {
    id: "netflix",
    name: "Netflix",
    color: "#e50914",
    searchUrl: (title) =>
      `https://www.netflix.com/search?q=${encodeURIComponent(cleanSearchTitle(title))}`,
  },
  {
    id: "prime",
    name: "Prime Video",
    color: "#00a8e1",
    searchUrl: (title) =>
      `https://www.primevideo.com/search?phrase=${encodeURIComponent(cleanSearchTitle(title))}`,
  },
  {
    id: "apple",
    name: "Apple TV",
    color: "#f0f0f3",
    searchUrl: (title) =>
      `https://tv.apple.com/kr/search?term=${encodeURIComponent(cleanSearchTitle(title))}`,
  },
  {
    id: "wavve",
    name: "웨이브",
    color: "#2875ff",
    searchUrl: (title) =>
      `https://www.wavve.com/search?searchWord=${encodeURIComponent(cleanSearchTitle(title))}`,
  },
  {
    id: "tving",
    name: "티빙",
    color: "#ff153c",
    searchUrl: (title) =>
      `https://www.tving.com/search?keyword=${encodeURIComponent(cleanSearchTitle(title))}`,
  },
  {
    id: "coupang",
    name: "쿠팡플레이",
    color: "#00a0e4",
    searchUrl: (title) =>
      `https://www.coupangplay.com/search?q=${encodeURIComponent(cleanSearchTitle(title))}`,
  },
  {
    id: "watcha",
    name: "왓챠",
    color: "#ff0558",
    searchUrl: (title) =>
      `https://watcha.com/search?query=${encodeURIComponent(cleanSearchTitle(title))}`,
  },
];

function parseUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === "443")
      ? url
      : null;
  } catch {
    return null;
  }
}

export function detectProvider(value: string): ProviderId | null {
  const url = parseUrl(value);
  if (!url) return null;
  if (["laftel.net", "www.laftel.net"].includes(url.hostname)) return "laftel";
  if (["netflix.com", "www.netflix.com"].includes(url.hostname))
    return "netflix";
  if (url.hostname === "tv.apple.com") return "apple";
  if (["crunchyroll.com", "www.crunchyroll.com"].includes(url.hostname))
    return "crunchyroll";
  if (["aniplustv.com", "www.aniplustv.com"].includes(url.hostname))
    return "aniplus";
  if (["primevideo.com", "www.primevideo.com"].includes(url.hostname))
    return "prime";
  if (["wavve.com", "www.wavve.com"].includes(url.hostname)) return "wavve";
  if (["tving.com", "www.tving.com"].includes(url.hostname)) return "tving";
  if (["coupangplay.com", "www.coupangplay.com"].includes(url.hostname))
    return "coupang";
  if (["watcha.com", "www.watcha.com"].includes(url.hostname)) return "watcha";
  return null;
}

export function providerTitleId(value: string): string | null {
  const url = parseUrl(value);
  if (!url) return null;
  switch (detectProvider(value)) {
    case "laftel": {
      const standalone =
        url.pathname.match(/^\/item\/(\d+)(?:\/[^/]*)?\/?$/)?.[1] ?? null;
      const modal = url.searchParams.get("modal");
      if (modal !== null) {
        return /^\d+$/.test(modal) &&
          (/^\/(?:search\/?)?$/.test(url.pathname) || standalone)
          ? modal
          : null;
      }
      return standalone;
    }
    case "netflix": {
      const title = url.pathname.match(
        /^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?title\/(\d+)\/?$/,
      )?.[1];
      const modal = url.searchParams.get("jbv");
      if (modal !== null) {
        return /^\d+$/.test(modal) &&
          (title ||
            /^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?(?:search|browse(?:\/genre\/\d+|\/my-list|\/originals)?)\/?$/.test(
              url.pathname,
            ))
          ? modal
          : null;
      }
      return title ?? null;
    }
    case "apple":
      return (
        url.pathname.match(
          /^\/[a-z]{2}\/(?:show|movie)\/(?:[^/]+\/)?(umc\.cmc\.[a-z\d]+)\/?$/i,
        )?.[1] ?? null
      );
    case "crunchyroll":
      return (
        url.pathname.match(
          /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?series\/([A-Z\d]+)(?:\/[^/]*)?\/?$/i,
        )?.[1] ?? null
      );
    case "aniplus":
      return url.pathname.match(/^\/items\/(\d+)\/?$/)?.[1] ?? null;
    case "prime":
      return (
        url.pathname.match(
          /^\/(?:-\/[a-z]{2}\/)?detail\/(?:[^/]+\/)?([A-Z\d]{10,32})(?:\/ref=[^/]*)?\/?$/,
        )?.[1] ?? null
      );
    case "tving":
      return url.pathname.match(/^\/contents\/([A-Z]\d+)\/?$/)?.[1] ?? null;
    case "coupang":
      return (
        url.pathname.match(
          /^\/content\/([a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})\/?$/i,
        )?.[1] ?? null
      );
    case "watcha":
      return (
        url.pathname.match(
          /^\/(?:[a-z]{2}\/)?contents\/([a-z\d]+)\/?$/i,
        )?.[1] ?? null
      );
    case "wavve": {
      if (!/^\/player\/(?:vod|movie)(?:\.html)?\/?$/.test(url.pathname))
        return null;
      const id =
        url.searchParams.get("contentid") ??
        url.searchParams.get("movieid") ??
        url.searchParams.get("programid");
      return id && /^[a-z\d_.-]{1,150}$/i.test(id) ? id : null;
    }
    default:
      return null;
  }
}

export function isDetailUrl(value: string): boolean {
  return providerTitleId(value) !== null;
}
export function safeProviderUrl(provider: ProviderId, value: string): boolean {
  return detectProvider(value) === provider && isDetailUrl(value);
}

export function canonicalizeProviderUrl(value: string): string | null {
  const url = parseUrl(value),
    id = providerTitleId(value),
    provider = detectProvider(value);
  if (!url || !id || !provider) return null;
  if (provider === "laftel")
    return url.searchParams.has("modal")
      ? `https://laftel.net/?modal=${id}`
      : `https://laftel.net/item/${id}`;
  if (provider === "netflix") return `https://www.netflix.com/title/${id}`;
  if (provider === "crunchyroll")
    return `https://www.crunchyroll.com/series/${id}`;
  if (provider === "aniplus") return `https://www.aniplustv.com/items/${id}`;
  if (provider === "prime") return `https://www.primevideo.com/detail/${id}`;
  if (provider === "tving") return `https://www.tving.com/contents/${id}`;
  if (provider === "coupang")
    return `https://www.coupangplay.com/content/${id}`;
  if (provider === "watcha") return `https://watcha.com/ko/contents/${id}`;
  if (provider === "wavve") {
    const key = ["contentid", "movieid", "programid"].find((key) =>
      url.searchParams.has(key),
    )!;
    return `https://www.wavve.com${url.pathname.replace(".html", "").replace(/\/$/, "")}?${key}=${encodeURIComponent(id)}`;
  }
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/$/, "");
  return url.href;
}

const brandName =
  "(?:라프텔|Laftel|넷플릭스|Netflix|Crunchyroll|Apple\\s*TV|애니플러스|ANIPLUS|Prime Video|Wavve|웨이브|TVING|티빙|쿠팡플레이|Coupang Play|왓챠|WATCHA)(?:\\+)?";
const brandSuffix = new RegExp(
  `\\s*[|ㅣᅵ–—-]\\s*${brandName}(?:\\s+.*)?$`,
  "i",
);
const englishWatchBrandSuffix =
  /\s*(?:[|–—-]\s*|on\s+)(?:Crunchyroll|Netflix|Prime Video|Apple\s*TV)(?:\+)?(?:\s+.*)?$/i;

function presentationText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u200b-\u200f\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function removeServiceDecoration(value: string): string {
  return value
    .replace(brandSuffix, "")
    .replace(
      /\s+on\s+(?:Netflix|Crunchyroll|Prime Video|Apple\s*TV)(?:\+)?$/i,
      "",
    )
    .replace(/^Prime Video:\s*/i, "")
    .replace(/\s+라프텔\s*-\s*애니 추천 애니 스트리밍 서비스$/i, "")
    .replace(/,?\s*지금 시청하세요\s*$/i, "")
    .replace(
      /\s*(?:[-|–—]\s*)?(?:Watch(?:\s+Now|\s+Online)?|지금 시청하기|시청하기)\s*$/i,
      (suffix, offset) => {
        // Only a separated CTA is decoration. "Night Watch" is a real title.
        return /[-|–—]/.test(suffix) ? "" : suffix;
      },
    )
    .trim();
}

/** Keep season, part, remake years and actual Watch title words. */
export function cleanTitle(value: string): string {
  const raw = presentationText(value);
  const brandedWatch =
    /^Watch\s+/i.test(raw) && englishWatchBrandSuffix.test(raw);
  let title = removeServiceDecoration(raw).replace(
    /^\s*(?:\((?:자막|더빙|한국어 더빙|한글자막)\)|\[(?:자막|더빙)\])\s*/i,
    "",
  );
  if (brandedWatch) title = title.replace(/^Watch\s+/i, "");
  if (/(?:넷플릭스|Netflix)/i.test(raw) && brandSuffix.test(raw)) {
    title = title.replace(/\s*(?:다시\s*)?(?:시청하기|보기)$/, "");
  }
  return title.trim().slice(0, 400);
}

export type PageTitleSource = "metadata" | "label" | "title";

/** Metadata/CTA labels have known watch wrappers; names and poster alt text do not. */
export function cleanPageTitle(
  value: string,
  provider: ProviderId,
  source: PageTitleSource,
  references: readonly string[] = [],
): string {
  const raw = presentationText(value);
  const undecorated = removeServiceDecoration(raw);
  const trusted = references.map(cleanTitle).filter(Boolean);
  const equal = (a: string, b: string) =>
    a.toLocaleLowerCase("en-US") === b.toLocaleLowerCase("en-US");
  // A JSON-LD/poster title can legitimately begin with Watch. It takes precedence
  // over the metadata convention, including "Watch Watch Dogs | Netflix".
  const same = trusted.find((title) => equal(title, undecorated));
  if (same) return same;
  const stripped = undecorated.replace(/^Watch\s+/i, "");
  const reference = trusted.find((title) => equal(title, stripped));
  if (reference) return reference;
  const normalized = cleanTitle(raw);
  if (normalized !== undecorated) return normalized;
  if (
    source !== "title" &&
    ["netflix", "crunchyroll", "prime"].includes(provider) &&
    /^Watch\s+/i.test(raw)
  ) {
    // Remove one action prefix, never every occurrence of the word.
    return stripped.trim().slice(0, 400);
  }
  return normalized;
}

/** Safe for stored/user-entered titles: never infer a bare English Watch is a CTA. */
export function cleanSearchTitle(
  value: string,
  provider?: ProviderId,
  references: readonly string[] = [],
): string {
  return provider
    ? cleanPageTitle(value, provider, "title", references)
    : cleanTitle(value);
}

export function normalizeTitle(value: string): string {
  return cleanTitle(value)
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export function titleVariants(value: string): string[] {
  const title = cleanTitle(value),
    variants = [title];
  // Apple publishes its Korean and original titles in this unambiguous paired form.
  const pair = title.match(/^['‘]([^'’]+)['’]\s+-\s+(.+)$/);
  if (pair) variants.push(pair[1], pair[2]);
  return [...new Set(variants.filter(Boolean))];
}

export function safeImageUrl(value: string, base?: string): string {
  try {
    const url = new URL(value, base);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : "";
  } catch {
    return "";
  }
}
