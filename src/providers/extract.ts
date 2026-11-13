import type { PageTitle } from "../core/types";
import {
  canonicalizeProviderUrl,
  cleanTitle,
  detectProvider,
  isDetailUrl,
  providerTitleId,
  safeImageUrl,
  titleVariants,
} from "./identity";

const generic =
  /^(?:라프텔(?:\s*-.*)?|Netflix|넷플릭스|Apple\s*TV\+?|Crunchyroll|애니플러스|ANIPLUS|Prime Video|Wavve(?:\(웨이브\))?|웨이브|TVING|티빙|쿠팡플레이|Coupang Play|왓챠|WATCHA|홈|Home|Search|검색|로그인|Sign in)$/i;
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
function meta(document: Document, name: string): string {
  return (
    document
      .querySelector<HTMLMetaElement>(
        `meta[property="${name}"], meta[name="${name}"]`,
      )
      ?.getAttribute("content")
      ?.trim() ?? ""
  );
}
function isTitle(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 400 &&
    !generic.test(value) &&
    !/애니 추천 애니 스트리밍 서비스|한일 동시\s*방영.*채널/.test(value)
  );
}
function structuredWorks(document: Document): Record<string, unknown>[] {
  const works: Record<string, unknown>[] = [];
  function visit(value: unknown, depth = 0) {
    if (!value || typeof value !== "object" || depth > 8) return;
    if (Array.isArray(value)) {
      value.slice(0, 100).forEach((v) => visit(v, depth + 1));
      return;
    }
    const obj = value as Record<string, unknown>;
    if (
      ["Movie", "TVSeries", "TVSeason"].some((type) =>
        (Array.isArray(obj["@type"]) ? obj["@type"] : [obj["@type"]]).includes(
          type,
        ),
      )
    )
      works.push(obj);
    if (obj["@graph"]) visit(obj["@graph"], depth + 1);
    if (obj.mainEntity) visit(obj.mainEntity, depth + 1);
  }
  for (const node of document.querySelectorAll(
    'script[type="application/ld+json"]',
  )) {
    try {
      if ((node.textContent?.length ?? 0) < 500_000)
        visit(JSON.parse(node.textContent ?? ""));
    } catch {
      /* Broken site metadata is not executable code. */
    }
  }
  return works;
}

export function extractPage(
  document: Document,
  value: string,
): PageTitle | null {
  const provider = detectProvider(value),
    url = canonicalizeProviderUrl(value);
  if (!provider || !url || !isDetailUrl(value)) return null;
  const current = new URL(value);
  const modal = provider === "netflix" && current.searchParams.has("jbv");
  const canonical = document
    .querySelector('link[rel="canonical"]')
    ?.getAttribute("href");
  // SPA transitions briefly retain the previous page's metadata; do not bookmark it under a new ID.
  if (!modal)
    for (const declaredUrl of [canonical, meta(document, "og:url")]) {
      if (!declaredUrl) continue;
      try {
        const target = new URL(declaredUrl, value).href;
        if (
          isDetailUrl(target) &&
          (detectProvider(target) !== provider ||
            providerTitleId(target) !== providerTitleId(value))
        )
          return null;
      } catch {
        /* Ignore malformed canonical metadata. */
      }
    }
  const root = modal
    ? document.querySelector('.previewModal--container, [role="dialog"]')
    : document;
  if (!root) return null;
  const works = structuredWorks(document);
  const work =
    works.find(
      (w) =>
        typeof w.url === "string" &&
        providerTitleId(w.url) === providerTitleId(value),
    ) ?? works[0];
  const logo = root.querySelector(
    'img.previewModal--player-titleTreatment-logo, .previewModal--player-titleTreatment-logo img, img.title-logo, [data-uia="title-logo"]',
  );
  const heading = [
    ...root.querySelectorAll('h1, [data-uia="title-info-title"], .title-title'),
  ]
    .map((n) => cleanTitle(n.textContent ?? ""))
    .find(isTitle);
  const choices = modal
    ? [text(logo?.getAttribute("alt")), heading ?? ""]
    : [
        text(work?.name),
        heading ?? "",
        meta(document, "og:title"),
        text(logo?.getAttribute("alt")),
        document.title,
      ];
  const title = choices.map(cleanTitle).find(isTitle);
  if (!title) return null;
  const alternate = work?.alternateName;
  const aliases = [
    ...new Set([
      title,
      ...(Array.isArray(alternate)
        ? alternate.filter((v) => typeof v === "string")
        : [text(alternate)]),
      ...titleVariants(title),
    ]),
  ]
    .filter((v) => v && v !== title)
    .slice(0, 12);
  let image = work?.image;
  if (Array.isArray(image)) image = image[0];
  if (image && typeof image === "object")
    image = (image as Record<string, unknown>).url;
  const modalImage = root
    .querySelector(
      'img.previewModal--player-background, .previewModal--player-container img:not([class*="logo"])',
    )
    ?.getAttribute("src");
  const imageUrl = safeImageUrl(
    modal ? text(modalImage) : meta(document, "og:image") || text(image),
    value,
  );
  const modalDescription = root.querySelector(
    '.previewModal--text, [data-uia="title-info-synopsis"]',
  )?.textContent;
  const description = (
    modal
      ? text(modalDescription)
      : text(work?.description) ||
        meta(document, "og:description") ||
        text(
          root.querySelector(
            '[data-uia="title-info-synopsis"], [data-testid="description"], .synopsis',
          )?.textContent,
        ) ||
        meta(document, "description")
  ).slice(0, 12000);
  const date = text(work?.datePublished ?? work?.startDate);
  const year = /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : undefined;
  return {
    provider,
    url,
    title,
    description,
    imageUrl,
    aliases,
    ...(year && year >= 1888 && year <= 2200 ? { year } : {}),
  };
}
