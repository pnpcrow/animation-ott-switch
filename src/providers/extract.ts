import type { PageTitle } from "../core/types";
import {
  canonicalizeProviderUrl,
  cleanPageTitle,
  cleanTitle,
  detectProvider,
  isDetailUrl,
  isWorkTitle as isTitle,
  normalizeTitle,
  providerTitleId,
  safeImageUrl,
  titleVariants,
} from "./identity";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
function descriptionText(value: unknown): string {
  const result = text(value);
  return /^\{\s*(?:줄거리|소개|설명|synopsis|description)\s*\}$/i.test(result)
    ? ""
    : result;
}
function meta(document: Document, name: string): string {
  const nodes = [
    ...document.querySelectorAll<HTMLMetaElement>(
      `meta[property="${name}"], meta[name="${name}"]`,
    ),
  ];
  // Vue-managed title metadata can coexist with the site's static home tags.
  const current =
    nodes.filter((node) => node.hasAttribute("data-vue-meta")).at(-1) ??
    nodes[0];
  return current?.getAttribute("content")?.trim() ?? "";
}

function declaredPageUrl(value: string, base: string): string {
  // Wavve publishes an official og:url without a scheme. Never treat an
  // arbitrary hostname-like string as a trusted provider URL.
  const absolute = `https://${value}`;
  return detectProvider(absolute) ? absolute : new URL(value, base).href;
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

function extractAniplus(
  document: Document,
  value: string,
  url: string,
): PageTitle | null {
  // Detail is a layer over the previous search document. Its background h1 and
  // static home metadata remain in the DOM even after the /items route opens.
  const heroes = [
    ...document.querySelectorAll(".detail_layer_pop .baner.live_detail"),
  ].filter((node) => isVisibleModal(node, document));
  if (heroes.length !== 1) return null;
  const hero = heroes[0];
  const heading = hero.querySelector(".float_right > h1");
  if (!heading || !isVisibleModal(heading, document)) return null;
  const rawTitle = [...heading.childNodes]
    .filter((node) => node.nodeType === 3)
    .map((node) => node.textContent ?? "")
    .join(" ");
  const title = cleanPageTitle(rawTitle, "aniplus", "title");
  if (!isTitle(title)) return null;
  const currentMeta = (name: string) =>
    [
      ...document.querySelectorAll<HTMLMetaElement>(
        `meta[data-rh="true"][property="${name}"], meta[data-rh="true"][name="${name}"]`,
      ),
    ]
      .at(-1)
      ?.getAttribute("content")
      ?.trim() ?? "";
  const canonical = document
    .querySelector('link[rel="canonical"]')
    ?.getAttribute("href");
  for (const declared of [canonical, currentMeta("og:url")]) {
    if (!declared) continue;
    try {
      const target = declaredPageUrl(declared, value);
      if (
        isDetailUrl(target) &&
        (detectProvider(target) !== "aniplus" ||
          providerTitleId(target) !== providerTitleId(value))
      )
        return null;
    } catch {
      /* Ignore malformed optional metadata. */
    }
  }
  const declaredTitle = currentMeta("og:title");
  if (declaredTitle) {
    const comparable = cleanPageTitle(
      declaredTitle.replace(/\s+애니플러스$/, ""),
      "aniplus",
      "metadata",
      [title],
    );
    if (normalizeTitle(comparable) !== normalizeTitle(title)) return null;
  }
  const aliases = [...heading.querySelectorAll(":scope > span")]
    .map((node) => cleanTitle(text(node.textContent)))
    .filter((alias) => isTitle(alias) && alias !== title);
  const summary = hero.querySelector(".float_right .summary_text");
  const copy = summary?.cloneNode(true) as Element | undefined;
  copy
    ?.querySelectorAll("h2, button, script, style")
    .forEach((node) => node.remove());
  copy?.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
  const image = hero.querySelector(".float_left img");
  return {
    provider: "aniplus",
    url,
    title,
    aliases: [...new Set(aliases)].slice(0, 12),
    description: text(copy?.textContent).slice(0, 12000),
    imageUrl: safeImageUrl(
      image?.getAttribute("src") ?? currentMeta("og:image"),
      value,
    ),
  };
}

export function extractPage(
  document: Document,
  value: string,
): PageTitle | null {
  const provider = detectProvider(value),
    url = canonicalizeProviderUrl(value);
  if (!provider || !url || !isDetailUrl(value)) return null;
  if (provider === "aniplus") return extractAniplus(document, value, url);
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
        const target = declaredPageUrl(declaredUrl, value);
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
  const wavveHero =
    provider === "wavve" ? root.querySelector(".video-wrap") : null;
  const tvingHeroes =
    provider === "tving"
      ? [...root.querySelectorAll("section")].filter(
          (section) =>
            isVisibleModal(section, document) &&
            !!section.querySelector(
              '[data-testid="content-detail-cta-button"]',
            ) &&
            !!section.querySelector("h1 img[alt]"),
        )
      : [];
  // The program route's schema, title tag and screen-reader heading include
  // the selected episode number. Its visible title image names the series.
  const tvingLogos = tvingHeroes
    .flatMap((section) => [...section.querySelectorAll("h1 img[alt]")])
    .filter((node) => isVisibleModal(node, document));
  const tvingTitles = [
    ...new Set(
      tvingLogos
        .map((node) => cleanTitle(text(node.getAttribute("alt"))))
        .filter(isTitle),
    ),
  ];
  if (tvingTitles.length > 1) return null;
  const tvingLogo = tvingLogos.find((node) =>
    isTitle(cleanTitle(text(node.getAttribute("alt")))),
  );
  const tvingHero = tvingLogo?.closest("section");
  const wavveLogo = wavveHero?.querySelector(
    ".video-detail-area h1.logo-box img[alt]",
  );
  const logo =
    wavveLogo ||
    tvingLogo ||
    root.querySelector(
      'img.previewModal--player-titleTreatment-logo, .previewModal--player-titleTreatment-logo img, img.title-logo, [data-uia="title-logo"]',
    );
  const rawHeadings = [
    ...(
      wavveHero?.querySelector(".video-detail-area") || root
    ).querySelectorAll('h1, [data-uia="title-info-title"], .title-title'),
  ]
    .filter(
      (heading) =>
        provider !== "wavve" ||
        !heading.closest("footer, nav, .footer, .episode-item-container"),
    )
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
  const sourceTitles = [
    ...(modal ? [] : [text(work?.name)]),
    text(logo?.getAttribute("alt")),
  ];
  if (wavveLogo || tvingLogo) sourceTitles.reverse();
  const authoritative = sourceTitles
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
  if (tvingLogo) {
    const agrees = (candidate: string) => {
      const direct = cleanPageTitle(candidate, "tving", "metadata", [title]);
      if (normalizeTitle(direct) === normalizeTitle(title)) return true;
      // Remove an episode wrapper only to corroborate the independently visible
      // logo on a program URL, never from arbitrary titles or movie names.
      return (
        /^P\d+$/.test(providerTitleId(value) ?? "") &&
        normalizeTitle(
          cleanTitle(direct.replace(/\s+(?:제\s*)?\d+\s*(?:화|회)$/, "")),
        ) === normalizeTitle(title)
      );
    };
    if (
      [text(work?.name), metadata[0] ?? ""]
        .filter(Boolean)
        .some((name) => !agrees(name))
    )
      return null;
  }
  if (
    wavveLogo &&
    metadata[0] &&
    normalizeTitle(metadata[0]) !== normalizeTitle(title)
  )
    return null;
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
  const wavvePoster = wavveHero
    ?.querySelector(".player-area .poster-box img.poster-thumb")
    ?.getAttribute("src");
  const imageUrl = safeImageUrl(
    modal
      ? text(modalImage)
      : text(wavvePoster) || meta(document, "og:image") || text(image),
    value,
  );
  const modalDescription = netflixOverlay
    ? root.querySelector(
        '.previewModal--text, [data-uia="title-info-synopsis"]',
      )?.textContent
    : laftelOverlay
      ? root.querySelector('[class*="ItemInfoBody__SummaryText"]')?.textContent
      : undefined;
  const wavveSynopsis = wavveHero?.querySelector(
    ".video-detail-area .detail-info-box.player-detail .content-clamp .text",
  );
  const description = (
    modal
      ? text(modalDescription)
      : descriptionText(wavveSynopsis?.getAttribute("aria-label")) ||
        descriptionText(wavveSynopsis?.textContent) ||
        descriptionText(work?.description) ||
        descriptionText(meta(document, "og:description")) ||
        descriptionText(
          root.querySelector(
            '[data-uia="title-info-synopsis"], [data-testid="description"], .synopsis',
          )?.textContent,
        ) ||
        descriptionText(meta(document, "description"))
  ).slice(0, 12000);
  const date =
    text(work?.datePublished ?? work?.startDate) ||
    (tvingHero
      ? ([...tvingHero.querySelectorAll(".tag_detail .tag")]
          .map((node) => text(node.textContent))
          .find((value) => /^\d{4}$/.test(value)) ?? "")
      : "") ||
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
