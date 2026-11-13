import type { PageTitle } from "../core/types";
import {
  canonicalizeProviderUrl,
  cleanPageTitle,
  cleanTitle,
  detectProvider,
  isDetailUrl,
  isWorkTitle as isTitle,
  providerTitleId,
  safeImageUrl,
  titleVariants,
} from "./identity";

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
function structuredWorks(document: ParentNode): Record<string, unknown>[] {
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

function isVisibleModal(element: Element, document: Document): boolean {
  if (element.closest('[hidden], [aria-hidden="true"]')) return false;
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (
      /display\s*:\s*none|visibility\s*:\s*hidden/i.test(
        node.getAttribute("style") ?? "",
      )
    )
      return false;
  }
  const view = document.defaultView;
  if (view && typeof view.getComputedStyle === "function") {
    const style = view.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  return true;
}

function netflixModal(document: Document, id: string): Element | null {
  const candidates = [
    ...document.querySelectorAll(
      '.previewModal--container, [data-uia="preview-modal"], [role="dialog"]',
    ),
  ];
  return (
    candidates.reverse().find((element) => {
      if (!isVisibleModal(element, document)) return false;
      if (
        !element.matches(
          '.previewModal--container, [data-uia="preview-modal"]',
        ) &&
        !element.querySelector(
          'img.previewModal--player-titleTreatment-logo, [data-uia="title-info-title"]',
        )
      )
        return false;
      const declaredId =
        element.getAttribute("data-videoid") ??
        element.getAttribute("data-video-id") ??
        element.getAttribute("data-title-id");
      return !declaredId || declaredId === id;
    }) ?? null
  );
}

function laftelModal(
  document: Document,
  id: string,
  pageUrl: string,
): Element | null {
  return (
    [...document.querySelectorAll("#item-modal")].reverse().find((element) => {
      if (
        !isVisibleModal(element, document) ||
        !element.querySelector('h1[class*="ItemInfoHeader__Title"]')
      )
        return false;
      const navigationIds = new Set<string>();
      const playerIds = new Set<string>();
      for (const anchor of element.querySelectorAll("a[href]")) {
        let url: URL;
        try {
          url = new URL(anchor.getAttribute("href") ?? "", pageUrl);
        } catch {
          continue;
        }
        if (detectProvider(url.href) !== "laftel") continue;
        const route = url.searchParams.get("route");
        if (route && ["episode", "review", "shop", "related"].includes(route)) {
          const target = providerTitleId(url.href);
          if (target) navigationIds.add(target);
        }
        const playerId = url.pathname.match(
          /^\/player\/(\d+)(?:\/\d+)?\/?$/,
        )?.[1];
        if (playerId) playerIds.add(playerId);
      }
      // A route can update before React replaces the old modal. Its own tabs/player
      // must identify the requested work; background recommendation links do not count.
      const evidence = navigationIds.size ? navigationIds : playerIds;
      return evidence.size === 1 && evidence.has(id);
    }) ?? null
  );
}

export function extractPage(
  document: Document,
  value: string,
): PageTitle | null {
  const provider = detectProvider(value),
    url = canonicalizeProviderUrl(value);
  if (!provider || !url || !isDetailUrl(value)) return null;
  const current = new URL(value);
  const netflixOverlay =
    provider === "netflix" && current.searchParams.has("jbv");
  const laftelOverlay =
    provider === "laftel" && current.searchParams.has("modal");
  const modal = netflixOverlay || laftelOverlay;
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
  const root = netflixOverlay
    ? netflixModal(document, providerTitleId(value)!)
    : laftelOverlay
      ? laftelModal(document, providerTitleId(value)!, value)
      : document;
  if (!root) return null;
  // The background home/search document may contain unrelated recommendation metadata.
  // A modal may only read structured data inside its own active subtree.
  const works = structuredWorks(root);
  const work =
    works.find(
      (w) =>
        typeof w.url === "string" &&
        providerTitleId(w.url) === providerTitleId(value),
    ) ?? works[0];
  const logo = root.querySelector(
    'img.previewModal--player-titleTreatment-logo, .previewModal--player-titleTreatment-logo img, img.title-logo, [data-uia="title-logo"]',
  );
  const rawHeadings = [
    ...root.querySelectorAll('h1, [data-uia="title-info-title"], .title-title'),
  ]
    .map((heading) => {
      const copy = heading.cloneNode(true) as Element;
      // Headings can wrap player buttons; those action labels are not the title.
      copy
        .querySelectorAll('button, [role="button"], svg')
        .forEach((node) => node.remove());
      return text(copy.textContent);
    })
    .filter(Boolean);
  const visualTitles = [text(logo?.getAttribute("alt")), ...rawHeadings]
    .map(cleanTitle)
    .filter(isTitle);
  const authoritative = [
    ...(modal ? [] : [text(work?.name)]),
    text(logo?.getAttribute("alt")),
  ]
    .map((title) => cleanPageTitle(title, provider, "title", visualTitles))
    .filter(isTitle);
  const metadata = modal
    ? []
    : [
        meta(document, "og:title"),
        meta(document, "twitter:title"),
        document.title,
      ]
        .map((title) =>
          cleanPageTitle(title, provider, "metadata", authoritative),
        )
        .filter(isTitle);
  const heading = rawHeadings
    .map((title) =>
      cleanPageTitle(title, provider, "title", [...authoritative, ...metadata]),
    )
    .find(isTitle);
  const choices = modal
    ? [authoritative[0] ?? "", heading ?? ""]
    : [authoritative[0] ?? "", heading ?? "", ...metadata];
  const title = choices.find(isTitle);
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
    .filter((v) => isTitle(v) && v !== title)
    .slice(0, 12);
  let image = work?.image;
  if (Array.isArray(image)) image = image[0];
  if (image && typeof image === "object")
    image = (image as Record<string, unknown>).url;
  const modalImage = netflixOverlay
    ? root
        .querySelector(
          'img.previewModal--player-background, .previewModal--player-container img:not([class*="logo"])',
        )
        ?.getAttribute("src")
    : laftelOverlay
      ? root
          .querySelector(
            'video[class*="DynamicItemVideo"][poster], [class*="DynamicItemVideo"] video[poster], [class*="ItemHeader"] video[poster]',
          )
          ?.getAttribute("poster") ||
        root.querySelector('[class*="ItemHeader"] img')?.getAttribute("src")
      : undefined;
  const imageUrl = safeImageUrl(
    modal ? text(modalImage) : meta(document, "og:image") || text(image),
    value,
  );
  const modalDescription = netflixOverlay
    ? root.querySelector(
        '.previewModal--text, [data-uia="title-info-synopsis"]',
      )?.textContent
    : laftelOverlay
      ? root.querySelector('[class*="ItemInfoBody__SummaryText"]')?.textContent
      : undefined;
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
  const date =
    text(work?.datePublished ?? work?.startDate) ||
    (netflixOverlay
      ? text(
          root.querySelector(
            '[data-uia="title-info-year"], .previewModal--detailsMetadata-left .year',
          )?.textContent,
        )
      : "");
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
