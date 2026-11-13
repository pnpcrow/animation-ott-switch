/** Read-only, bounded navigation evidence. A returned URL is not a verified work. */
export interface LinkLocalNode {
  tag: string;
  role: string;
  classes: string[];
  ariaLabel: string;
  text: string;
  textTruncated: boolean;
}

export interface WorkLinkEvidence {
  /** Ephemeral reference for the caller's scope/locator mapping; never serialize it. */
  element: Element;
  source:
    "href" | "data-href" | "data-url" | "action" | "onclick" | "opaque-action";
  status: "url" | "unknown";
  url?: string;
  reason?: "unobservable-action-target" | "script-target-not-literal";
  sameOrigin?: boolean;
  label: string;
  workHint: boolean;
  episodeHint: boolean;
  requiresVerification: true;
  context: {
    self: LinkLocalNode;
    parent?: LinkLocalNode;
    previous?: LinkLocalNode;
    next?: LinkLocalNode;
  };
}

export interface WorkLinkEvidenceResult {
  candidates: WorkLinkEvidence[];
  /** Includes traversal and bounded neighborhood reads, including repeated nodes. */
  visited: number;
  truncated: boolean;
}

interface Budget {
  visited: number;
  maximum: number;
  exhausted: boolean;
}

const OMIT = new Set([
  "HEAD",
  "SCRIPT",
  "STYLE",
  "TEMPLATE",
  "NOSCRIPT",
  "IFRAME",
  "SVG",
  "NAV",
  "FOOTER",
  "INPUT",
  "TEXTAREA",
  "SELECT",
]);
const PRIVATE_ROUTE =
  /^(?:log-?(?:in|out)|sign-?(?:in|out|up)|account|accounts|profile|profiles|subscribe|subscription|subscriptions|checkout|billing|payment|payments|purchase|buy|cart|settings|download|downloads|delete|remove|oauth|authorize|auth|callback|register)$/i;
const PRIVATE_QUERY =
  /^(?:(?:access|refresh|id|auth)[_-]?token|token|session(?:id|[_-]id)?|csrf(?:[_-]token)?|password|passwd|email|signature|sig|authorization|auth|code|x-amz-.+)$/i;
const PRIVATE_LABEL =
  /^(?:로그\s*(?:인|아웃)|회원\s*가입|구독(?:하기|신청|변경)?|결제(?:하기)?|구매(?:하기)?|다운로드|프로필|계정|설정|sign[ -]?(?:in|out|up)|log[ -]?(?:in|out)|subscribe(?:\s+now)?|buy(?:\s+now)?|purchase|checkout|download|profile|account|settings)(?:\s|$)/i;
const WORK_PATH =
  /\/(?:titles?|series|movies?|contents?|details?|items?|programs?|vod|shows?)(?:\/|$)|[?&](?:jbv|modal|contentid|programid)=/i;
const EPISODE =
  /(?:^|[\s/_-])episodes?(?:$|[\s/_-])|(?:^|\s)\d+\s*(?:화|회)(?:\s|$)/i;
const LITERAL = "(['\"])([^'\"\\\\\\r\\n]{1,2048})\\1";
const LOCATION_ASSIGN = new RegExp(
  `^\\s*(?:(?:window|document)\\.)?location(?:\\.href)?\\s*=\\s*${LITERAL}\\s*;?\\s*(?:return\\s+false\\s*;?)?\\s*$`,
);
const LOCATION_CALL = new RegExp(
  `^\\s*(?:return\\s+)?(?:(?:(?:window|document)\\.)?location\\.(?:assign|replace)|window\\.open)\\s*\\(\\s*${LITERAL}(?:\\s*,\\s*['\"]_(?:self|blank)['\"])?\\s*\\)\\s*;?\\s*(?:return\\s+false\\s*;?)?\\s*$`,
);

function limit(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  return value === undefined || !Number.isFinite(value)
    ? fallback
    : Math.max(0, Math.min(maximum, Math.floor(value)));
}

function take(budget: Budget): boolean {
  if (budget.visited >= budget.maximum) {
    budget.exhausted = true;
    return false;
  }
  budget.visited++;
  return true;
}

function short(value: string | null | undefined, length = 100): string {
  // Bound before normalization, so enormous attributes cannot create huge arrays.
  return (value ?? "")
    .slice(0, length * 2)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, length);
}

function omitted(element: Element): boolean {
  if (
    OMIT.has(element.tagName.toUpperCase()) ||
    element.hasAttribute("hidden") ||
    element.hasAttribute("inert") ||
    element.getAttribute("aria-hidden") === "true"
  )
    return true;
  if (
    element.tagName.toUpperCase() === "FORM" &&
    (element.getAttribute("method") ?? "get").toLowerCase() !== "get"
  )
    return true;
  if (
    /^(?:navigation|menu|menubar|banner)$/i.test(
      element.getAttribute("role") ?? "",
    )
  )
    return true;
  if (
    element.tagName.toUpperCase() === "DIALOG" &&
    !element.hasAttribute("open")
  )
    return true;
  if (
    /(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse))/i.test(
      element.getAttribute("style") ?? "",
    )
  )
    return true;
  const view = element.ownerDocument.defaultView;
  if (view && typeof view.getComputedStyle === "function") {
    const style = view.getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse"
    )
      return true;
  }
  return false;
}

function localText(
  element: Element,
  budget: Budget,
): { text: string; truncated: boolean } {
  const pieces: string[] = [];
  let characters = 0,
    count = 0,
    truncated = false;
  const append = (raw: string) => {
    const available = Math.max(0, 100 - characters - (pieces.length ? 1 : 0));
    // Normalize only the bounded window. Whitespace cleanup is not truncation.
    const sample = raw.slice(0, available * 2);
    const normalized = sample.replace(/\s+/g, " ").trim();
    const part = normalized.slice(0, available);
    if (part) {
      pieces.push(part);
      characters += part.length + (pieces.length > 1 ? 1 : 0);
    }
    if (raw.length > sample.length || normalized.length > available)
      truncated = true;
  };
  // At most 10 nodes / depth 2 / 100 characters; no full-subtree textContent.
  let current: Node | null = element.firstChild;
  let depth = 1;
  const resume: Array<{ node: Node; depth: number }> = [];
  while (current && count < 10 && characters < 100) {
    if (!take(budget)) {
      truncated = true;
      break;
    }
    count++;
    let descend = false;
    if (current.nodeType === 3) {
      append(current.nodeValue ?? "");
    } else if (current.nodeType === 1 && !omitted(current as Element)) {
      const child = current as Element;
      if (child.tagName.toUpperCase() === "IMG") {
        append(child.getAttribute("alt") ?? "");
      }
      descend = depth < 2 && !!child.firstChild;
      if (depth >= 2 && child.firstChild) truncated = true;
    }
    if (descend) {
      if (current.nextSibling)
        resume.push({ node: current.nextSibling, depth });
      current = current.firstChild;
      depth++;
    } else if (current.nextSibling) current = current.nextSibling;
    else {
      const next = resume.pop();
      current = next?.node ?? null;
      depth = next?.depth ?? 1;
    }
  }
  return {
    text: pieces.filter(Boolean).join(" ").slice(0, 100),
    truncated: truncated || !!current,
  };
}

function snapshot(
  element: Element,
  budget: Budget,
  alreadyCounted = false,
): LinkLocalNode | undefined {
  if (!alreadyCounted && !take(budget)) return;
  if (!alreadyCounted && omitted(element)) return;
  const text = localText(element, budget);
  return {
    tag: element.tagName.toLowerCase(),
    role: short(element.getAttribute("role"), 32),
    classes: short(element.getAttribute("class"), 160)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 4)
      .map((value) => value.slice(0, 40)),
    ariaLabel: short(element.getAttribute("aria-label")),
    text: text.text,
    textTruncated: text.truncated,
  };
}

function safeTarget(raw: string, page: URL): string | null {
  if (
    !raw ||
    raw.length > 2048 ||
    /[\u0000-\u001f\u007f]/.test(raw) ||
    raw === "#"
  )
    return null;
  try {
    const target = new URL(raw, page);
    if (
      !/^https?:$/.test(target.protocol) ||
      target.username ||
      target.password
    )
      return null;
    const segments = decodeURIComponent(target.pathname).split("/");
    if (
      segments.some((part) => PRIVATE_ROUTE.test(part)) ||
      [...target.searchParams.keys()].some((key) => PRIVATE_QUERY.test(key))
    )
      return null;
    return target.href;
  } catch {
    return null;
  }
}

type Target = Pick<WorkLinkEvidence, "source" | "status" | "url" | "reason">;
function target(element: Element, page: URL): Target | null {
  if (
    element.hasAttribute("download") ||
    element.hasAttribute("disabled") ||
    element.getAttribute("aria-disabled") === "true"
  )
    return null;
  const tag = element.tagName.toUpperCase();
  const onclick = element.getAttribute("onclick");
  let declared: Target | null = null;
  for (const attribute of [
    "href",
    "data-href",
    "data-url",
    "action",
  ] as const) {
    if (attribute === "href" && tag !== "A" && tag !== "AREA") continue;
    if (
      attribute === "action" &&
      (tag !== "FORM" ||
        (element.getAttribute("method") ?? "get").toLowerCase() !== "get")
    )
      continue;
    const raw = element.getAttribute(attribute)?.trim();
    if (!raw || raw === "#" || /^javascript:\s*void\(0\);?$/i.test(raw))
      continue;
    const url = safeTarget(raw, page);
    // Explicit unsafe targets are rejected, not reclassified as clickable unknowns.
    if (!url) return null;
    declared = { source: attribute, status: "url", url };
    break;
  }
  if (onclick !== null) {
    if (
      /\b(?:logout|signout|checkout|purchase|subscribe|download|delete)\w*\s*\(/i.test(
        onclick,
      )
    )
      return null;
    const literal =
      onclick.length <= 4096
        ? (LOCATION_ASSIGN.exec(onclick) ?? LOCATION_CALL.exec(onclick))
        : null;
    if (literal) {
      const url = safeTarget(literal[2], page);
      return url ? { source: "onclick", status: "url", url } : null;
    }
    return {
      source: "onclick",
      status: "unknown",
      reason: "script-target-not-literal",
    };
  }
  if (declared) return declared;
  if (
    tag === "BUTTON" ||
    element.getAttribute("role") === "button" ||
    element.hasAttribute("data-action") ||
    (tag === "A" &&
      /^(?:#|javascript:\s*void\(0\);?)$/i.test(
        element.getAttribute("href")?.trim() ?? "",
      ))
  )
    return {
      source: "opaque-action",
      status: "unknown",
      reason: "unobservable-action-target",
    };
  return null;
}

/** No clicks, JavaScript evaluation, framework state access, fetches or script scraping. */
export function collectWorkLinkEvidence(
  root: ParentNode,
  pageUrl: string,
  options: { maxCandidates?: number; maxVisited?: number } = {},
): WorkLinkEvidenceResult {
  const budget: Budget = {
    visited: 0,
    maximum: limit(options.maxVisited, 1500, 8000),
    exhausted: false,
  };
  const maximum = limit(options.maxCandidates, 24, 128),
    candidates: WorkLinkEvidence[] = [];
  const result = (): WorkLinkEvidenceResult => ({
    candidates,
    visited: budget.visited,
    truncated: budget.exhausted,
  });
  let page: URL;
  try {
    page = new URL(pageUrl);
    if (!/^https?:$/.test(page.protocol)) return result();
  } catch {
    return result();
  }
  if (!maximum || !budget.maximum) {
    budget.exhausted = true;
    return result();
  }
  const boundary = root as Node;
  // Do not collect a scoped subtree hidden by an ancestor outside that subtree.
  let ancestor = boundary.parentElement;
  let ancestors = 0;
  while (ancestor && ancestors++ < 32) {
    if (!take(budget) || omitted(ancestor)) return result();
    ancestor = ancestor.parentElement;
  }
  if (ancestor) {
    budget.exhausted = true;
    return result();
  }
  let current: Node | null = boundary;
  while (current) {
    if (!take(budget)) break;
    let descend = true;
    if (current.nodeType === 1) {
      const element = current as Element;
      descend = !omitted(element);
      if (descend) {
        const found = target(element, page);
        if (found) {
          const self = snapshot(element, budget, true)!;
          const label =
            self.ariaLabel || short(element.getAttribute("title")) || self.text;
          if (!PRIVATE_LABEL.test(label)) {
            const parent =
              element === boundary ? undefined : element.parentElement;
            const context: WorkLinkEvidence["context"] = { self };
            if (parent) context.parent = snapshot(parent, budget);
            if (element !== boundary && element.previousElementSibling)
              context.previous = snapshot(
                element.previousElementSibling,
                budget,
              );
            if (element !== boundary && element.nextElementSibling)
              context.next = snapshot(element.nextElementSibling, budget);
            const semantic = `${self.classes.join(" ")} ${context.parent?.classes.join(" ") ?? ""} ${label}`;
            candidates.push({
              element,
              ...found,
              label,
              sameOrigin: found.url
                ? new URL(found.url).origin === page.origin
                : undefined,
              workHint: !!found.url && WORK_PATH.test(found.url),
              episodeHint: EPISODE.test(`${found.url ?? ""} ${semantic}`),
              requiresVerification: true,
              context,
            });
            if (candidates.length >= maximum) {
              budget.exhausted = true;
              break;
            }
          }
        }
      }
    }
    if (descend && current.firstChild) {
      current = current.firstChild;
      continue;
    }
    while (current && current !== boundary && !current.nextSibling) {
      if (!take(budget)) return result();
      current = current.parentNode;
    }
    if (!current || current === boundary) break;
    current = current.nextSibling;
  }
  return result();
}
