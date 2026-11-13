import type { ProviderId } from "../core/types";
import { detectProvider } from "./identity";
import { isSearchUrl } from "./search-results";

const synced = new WeakMap<HTMLInputElement, string>();

function visible(input: HTMLInputElement): boolean {
  if (input.closest('[hidden], [aria-hidden="true"]')) return false;
  for (let node: Element | null = input; node; node = node.parentElement) {
    if (
      /display\s*:\s*none|visibility\s*:\s*hidden/i.test(
        node.getAttribute("style") || "",
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

/** Prime executes the URL query but leaves its header input blank on a full load.
 * Mirror that query once per visible field; never submit, focus, or replace edits. */
export function syncSearchInput(
  document: Document,
  provider: ProviderId,
  pageUrl: string,
): boolean {
  if (provider !== "prime" || !isSearchUrl(provider, pageUrl)) return false;
  const current = new URL(pageUrl);
  const query = current.searchParams.get("phrase")?.trim();
  if (!query || query.length > 500) return false;
  const key = `${provider}:${query}`;
  let changed = false;
  for (const input of document.querySelectorAll<HTMLInputElement>(
    'input[type="search"][name="phrase"]',
  )) {
    if (input.disabled || input.readOnly || !visible(input)) continue;
    const form = input.closest("form");
    if (!form || (form.getAttribute("method") || "get").toLowerCase() !== "get")
      continue;
    let action: URL;
    try {
      action = new URL(form.getAttribute("action") || pageUrl, pageUrl);
    } catch {
      continue;
    }
    if (
      detectProvider(action.href) !== provider ||
      action.origin !== current.origin ||
      !/^\/(?:-\/[a-z]{2}\/)?search(?:\/ref=[^/]+)?\/?$/i.test(action.pathname)
    )
      continue;
    if (synced.get(input) === key) continue;
    // Treat an existing value as an edit, even if it differs from the URL query.
    synced.set(input, key);
    if (input.value) continue;
    const view = document.defaultView;
    const setter =
      view &&
      Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, "value")
        ?.set;
    if (setter) setter.call(input, query);
    else input.value = query;
    const EventClass = view?.Event ?? Event;
    input.dispatchEvent(new EventClass("input", { bubbles: true }));
    input.dispatchEvent(new EventClass("change", { bubbles: true }));
    changed = true;
  }
  return changed;
}
