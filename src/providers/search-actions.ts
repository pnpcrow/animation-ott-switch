import type { ProviderId } from "../core/types";
import {
  cleanPageTitle,
  cleanTitle,
  detectProvider,
  normalizeTitle,
  safeImageUrl,
} from "./identity";

export interface SearchAction {
  /** Snapshot of the card and search context, not an executable selector or URL. */
  key: string;
  title: string;
}

interface ActionElement {
  action: SearchAction;
  element: HTMLElement;
}

const EXCLUDED =
  'nav, footer, [role="navigation"], [aria-label*="추천"], [data-testid*="recommend" i], [data-testid*="episode" i]';

function cardTitle(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 400 &&
    !/^(?:재생|시청|자세히\s*보기|더보기|포스터|썸네일|poster|thumbnail|play|watch(?:\s+now)?|image)$/i.test(
      value,
    )
  );
}

function visible(element: Element): boolean {
  if (element.closest('[hidden], [aria-hidden="true"], template, noscript'))
    return false;
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (
      /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(
        node.getAttribute("style") ?? "",
      )
    )
      return false;
    const view = node.ownerDocument.defaultView;
    if (view && typeof view.getComputedStyle === "function") {
      const style = view.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden")
        return false;
    }
  }
  return true;
}

function ownHeading(section: Element): string {
  return (
    [...section.querySelectorAll('h1, h2, h3, [role="heading"]')]
      .find((node) => node.closest("section") === section && visible(node))
      ?.textContent?.normalize("NFKC")
      .replace(/\s+/g, "") ?? ""
  );
}

function inExcludedCollection(section: Element): boolean {
  for (
    let parent = section.parentElement?.closest("section");
    parent;
    parent = parent.parentElement?.closest("section")
  ) {
    if (/^(?:에피소드|에디터|추천)/.test(ownHeading(parent))) return true;
  }
  return false;
}

function collectWavveActions(
  document: Document,
  provider: ProviderId,
  pageUrl: string,
): ActionElement[] {
  if (provider !== "wavve" || detectProvider(pageUrl) !== provider) return [];
  const url = new URL(pageUrl);
  const query = url.searchParams.get("searchWord")?.trim();
  if (!/^\/search(?:\.html)?\/?$/i.test(url.pathname) || !query) return [];

  const found: ActionElement[] = [];
  const sections = [...document.querySelectorAll("section")].slice(0, 200);
  for (const [sectionIndex, section] of sections.entries()) {
    if (
      !visible(section) ||
      section.closest(EXCLUDED) ||
      inExcludedCollection(section)
    )
      continue;
    const category = ownHeading(section);
    // Search has separate program/movie, episode, and editor collections. Only
    // top-level work results may be opened; episode/recommendation cards are excluded.
    if (!/^(?:프로그램|영화)\d*$/.test(category)) continue;

    const cards = [...section.querySelectorAll<HTMLElement>('a[role="button"]')]
      .filter((node) => node.closest("section") === section)
      .slice(0, 200);
    for (const [cardIndex, element] of cards.entries()) {
      if (found.length >= 200) return found;
      if (
        !visible(element) ||
        element.closest(EXCLUDED) ||
        element.getAttribute("aria-disabled") === "true" ||
        element.hasAttribute("disabled")
      )
        continue;
      // Never execute arbitrary javascript: URLs. The observed Wavve navigation
      // cards have an inert href and a normal site click listener.
      if (
        !/^javascript:\s*void\(0\);?$/i.test(
          element.getAttribute("href")?.trim() ?? "",
        )
      )
        continue;
      const image = [
        ...element.querySelectorAll<HTMLImageElement>("img[alt]"),
      ].find((node) => visible(node) && cardTitle(cleanTitle(node.alt)));
      if (!image) continue;
      const posterTitle = cleanTitle(image.alt);
      const rawLabel = element.getAttribute("aria-label")?.trim();
      const title = rawLabel
        ? cleanPageTitle(rawLabel, provider, "label", [posterTitle])
        : posterTitle;
      if (
        !cardTitle(title) ||
        normalizeTitle(title) !== normalizeTitle(posterTitle)
      )
        continue;
      const imageUrl = safeImageUrl(image.getAttribute("src") ?? "", pageUrl);
      if (!imageUrl) continue;
      const key = JSON.stringify([
        query,
        category,
        sectionIndex,
        cardIndex,
        title,
        imageUrl,
      ]);
      if (key.length > 4096) continue;
      found.push({ action: { key, title }, element });
    }
  }
  return found;
}

function collectAniplusActions(
  document: Document,
  pageUrl: string,
): ActionElement[] {
  const url = new URL(pageUrl);
  const query = url.searchParams.get("st")?.trim();
  if (!/^\/Search\/?$/i.test(url.pathname) || !query) return [];
  const found: ActionElement[] = [];
  const groups = [...document.querySelectorAll(".vod_list_group")].slice(
    0,
    100,
  );
  for (const [groupIndex, group] of groups.entries()) {
    if (!visible(group) || group.closest(EXCLUDED)) continue;
    const heading = [...group.querySelectorAll("h1")].find(
      (node) => node.closest(".vod_list_group") === group && visible(node),
    );
    // The same card styles appear elsewhere on the site. Require the actual
    // result heading and its current query, not just a matching CSS class.
    if (!heading || !/에\s*대한\s*검색\s*결과/.test(heading.textContent ?? ""))
      continue;
    const shownQuery = heading
      .querySelector("em")
      ?.textContent?.normalize("NFKC")
      .trim()
      .replace(/^["'“”‘’]|["'“”‘’]$/g, "");
    if (!shownQuery || normalizeTitle(shownQuery) !== normalizeTitle(query))
      continue;
    const cards = [
      ...group.querySelectorAll<HTMLElement>(".vod_vod_list .div_li"),
    ]
      .filter((node) => node.closest(".vod_list_group") === group)
      .slice(0, 200);
    for (const [cardIndex, card] of cards.entries()) {
      if (found.length >= 200) return found;
      if (!visible(card) || card.closest(EXCLUDED)) continue;
      const element = [...card.children].find(
        (node) =>
          node.tagName === "DIV" && node.classList.contains("list_img_bg"),
      ) as HTMLElement | undefined;
      const label = [...card.children].find((node) => node.tagName === "P");
      if (
        !element ||
        !label ||
        !visible(element) ||
        !visible(label) ||
        element.getAttribute("aria-disabled") === "true" ||
        element.hasAttribute("disabled") ||
        card.getAttribute("aria-disabled") === "true"
      )
        continue;
      // Genre badges live inside a child span. Only the direct text nodes are
      // the work label; the image itself has no alt text on the observed site.
      const title = cleanTitle(
        [...label.childNodes]
          .filter((node) => node.nodeType === 3)
          .map((node) => node.textContent ?? "")
          .join(" "),
      );
      if (!cardTitle(title)) continue;
      const image = [...element.querySelectorAll<HTMLImageElement>("img")].find(
        (node) => visible(node),
      );
      const imageUrl =
        image && safeImageUrl(image.getAttribute("src") ?? "", pageUrl);
      if (!imageUrl) continue;
      const key = JSON.stringify([
        "aniplus",
        query,
        groupIndex,
        cardIndex,
        title,
        imageUrl,
      ]);
      if (key.length > 4096) continue;
      found.push({ action: { key, title }, element });
    }
  }
  return found;
}

function collectActions(
  document: Document,
  provider: ProviderId,
  pageUrl: string,
): ActionElement[] {
  if (detectProvider(pageUrl) !== provider) return [];
  if (provider === "aniplus") return collectAniplusActions(document, pageUrl);
  return collectWavveActions(document, provider, pageUrl);
}

/** DOM-only discovery: no click, fetch, page script evaluation, or framework access. */
export function readSearchActions(
  document: Document,
  provider: ProviderId,
  pageUrl: string,
): SearchAction[] {
  return collectActions(document, provider, pageUrl).map(
    ({ action }) => action,
  );
}

/** Revalidate the snapshot immediately before invoking the site's normal card handler. */
export function activateSearchAction(
  document: Document,
  provider: ProviderId,
  pageUrl: string,
  action: SearchAction,
): boolean {
  if (
    !action ||
    typeof action.key !== "string" ||
    action.key.length > 4096 ||
    typeof action.title !== "string"
  )
    return false;
  const matches = collectActions(document, provider, pageUrl).filter(
    ({ action: current }) =>
      current.key === action.key && current.title === action.title,
  );
  if (matches.length !== 1) return false;
  matches[0].element.click();
  return true;
}
