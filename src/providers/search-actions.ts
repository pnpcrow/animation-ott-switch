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

function collectActions(
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
