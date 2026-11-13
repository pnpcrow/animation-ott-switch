import {
  detectProvider,
  safeProviderUrl,
  canonicalizeProviderUrl,
} from "../../src/providers/identity.ts";

// Generic semantic evidence only. Site adapters remain the primary extraction path.
// This never marks a search complete or executes page scripts to discover links.
export function collectEvidence(document, { pageUrl, query }) {
  const provider = detectProvider(pageUrl);
  if (!provider) throw new Error("지원하는 공식 OTT 페이지가 아닙니다.");
  const evidence = [];
  const seen = new Set();
  const text = (value, length = 500) =>
    (value || "").replace(/\s+/g, " ").trim().slice(0, length);
  const visible = (element) =>
    !element.closest('[hidden],[aria-hidden="true"],nav,footer') &&
    (!element.getClientRects || element.getClientRects().length > 0);
  const https = (value) => {
    if (typeof value !== "string" || !value.trim()) return "";
    try {
      const url = new URL(value, pageUrl);
      return url.protocol === "https:" && !url.username && !url.password
        ? url.href
        : "";
    } catch {
      return "";
    }
  };
  const add = (kind, value, role, scope) => {
    value =
      kind === "image"
        ? https(value)
        : text(value, kind === "description" ? 600 : 300);
    if (value.length > 1200) return;
    if (!value || seen.has(`${kind}:${value}`) || evidence.length >= 20) return;
    seen.add(`${kind}:${value}`);
    evidence.push({ id: `e${evidence.length + 1}`, kind, value, role, scope });
  };
  // Document-level metadata may be stale on SPAs; keep its provenance distinct.
  add("title", document.title, "document-title", "document");
  for (const element of Array.from(
    document.querySelectorAll(
      'meta[property="og:title"],meta[name="twitter:title"]',
    ),
  ).slice(-3))
    add("title", element.content, "social-meta", "document");
  for (const element of Array.from(
    document.querySelectorAll(
      'main h1,[role="main"] h1,h1,[role="heading"][aria-level="1"]',
    ),
  )
    .filter(visible)
    .slice(0, 4)) {
    add(
      "title",
      element.textContent || element.getAttribute("aria-label"),
      "h1",
      "visible-main",
    );
    for (const image of Array.from(element.querySelectorAll("img[alt]")).slice(
      0,
      1,
    ))
      add("title", image.alt, "h1-logo-alt", "visible-main");
  }
  for (const element of Array.from(
    document.querySelectorAll(
      'meta[property="og:image"],meta[name="twitter:image"]',
    ),
  ).slice(-2))
    add("image", element.content, "social-meta", "document");
  for (const element of Array.from(
    document.querySelectorAll(
      'main img[src],article img[src],[role="main"] img[src]',
    ),
  )
    .filter(visible)
    .filter((image) => image.width >= 180 || image.height >= 180)
    .slice(0, 3))
    add(
      "image",
      element.currentSrc || element.src,
      "large-visible-image",
      "visible-main",
    );
  for (const element of Array.from(
    document.querySelectorAll(
      'meta[property="og:description"],meta[name="description"]',
    ),
  ).slice(-2))
    add("description", element.content, "social-meta", "document");
  for (const element of Array.from(
    document.querySelectorAll('main p,article p,[role="main"] p'),
  )
    .filter(visible)
    .filter((element) => text(element.textContent).length >= 35)
    .slice(0, 3))
    add("description", element.textContent, "paragraph", "visible-main");

  const candidates = [];
  const urls = new Set();
  for (const anchor of document.querySelectorAll("a[href]")) {
    if (!visible(anchor)) continue;
    const rawHref = anchor.getAttribute("href");
    if (!rawHref?.trim() || rawHref.trim().startsWith("#")) continue;
    const href = https(rawHref);
    if (!safeProviderUrl(provider, href)) continue;
    const url = canonicalizeProviderUrl(href);
    if (!url || urls.has(url)) continue;
    const title = text(
      anchor.getAttribute("aria-label") ||
        anchor.querySelector("img[alt]")?.getAttribute("alt") ||
        anchor.getAttribute("title") ||
        anchor.textContent,
      180,
    );
    if (!title) continue;
    urls.add(url);
    candidates.push({
      id: `c${candidates.length + 1}`,
      title,
      url,
      aliases: [],
      kind: "",
      version: "",
      year: null,
    });
    if (candidates.length >= 12) break;
  }
  const input = {
    provider,
    query:
      typeof query === "string"
        ? {
            title: text(query, 300),
            aliases: [],
            kind: "",
            version: "",
            year: null,
          }
        : {
            title: text(query?.title, 300),
            aliases: Array.isArray(query?.aliases)
              ? query.aliases.slice(0, 6).map((value) => text(value, 300))
              : [],
            kind: text(query?.kind, 80),
            version: text(query?.version, 100),
            year: Number.isInteger(query?.year) ? query.year : null,
          },
    complete: false,
    evidence,
    candidates,
  };
  // Keep a conservative context budget, never truncate an individual observed URL.
  const bytes = () => new TextEncoder().encode(JSON.stringify(input)).length;
  while (bytes() > 6800 && input.candidates.length) input.candidates.pop();
  while (bytes() > 6800 && input.evidence.length) input.evidence.pop();
  return {
    observedAt: new Date().toISOString(),
    pageUrl,
    input,
    notes: [
      "Generic DOM observation; review identity and expected labels separately.",
      "Search completeness and current Korean subscription availability are not inferred.",
      "URL-less cards require the existing site adapter; this collector never clicks.",
    ],
  };
}
