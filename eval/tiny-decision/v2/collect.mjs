// Enrich generic candidates with observed attributes; no gold or provider adapter.
// Pass the v1 snapshot to retain stable candidate IDs and original observations.
export function enrichDomSnapshot(document, pageUrl, snapshot) {
  const clean = (s, n = 160) =>
    String(s || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, n);
  const safeUrl = (s) => {
    if (!s) return null;
    try {
      const u = new URL(s, pageUrl);
      if (u.protocol !== "https:" || u.username || u.password) return null;
      for (const key of [...u.searchParams.keys()])
        if (/token|signature|credential|policy|key-pair-id/i.test(key))
          u.searchParams.delete(key);
      return u.href;
    } catch {
      return null;
    }
  };
  const bodyTexts = [];
  const walkText = (node) => {
    if (bodyTexts.join(" ").length >= 180) return;
    if (node.nodeType === 3) {
      const text = clean(node.textContent, 180);
      if (text) bodyTexts.push(text);
      return;
    }
    if (
      node.nodeType === 1 &&
      /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(node.tagName)
    )
      return;
    for (const child of node.childNodes || []) walkText(child);
  };
  if (document.body) walkText(document.body);
  const path = (node) => {
    const steps = [];
    for (let n = node; n && steps.length < 4; n = n.parentElement) {
      const position = n.parentElement
        ? [...n.parentElement.children]
            .filter((x) => x.tagName === n.tagName)
            .indexOf(n) + 1
        : 1;
      steps.unshift(`${n.tagName.toLowerCase()}:${position}`);
    }
    return steps.join("/");
  };
  const hidden = (node) => {
    for (let n = node; n; n = n.parentElement) {
      if (
        n.hasAttribute("hidden") ||
        n.hasAttribute("inert") ||
        n.getAttribute("aria-hidden") === "true" ||
        /display\s*:\s*none|visibility\s*:\s*hidden/i.test(
          n.getAttribute("style") || "",
        )
      )
        return true;
      const view = document.defaultView;
      if (view?.getComputedStyle) {
        const style = view.getComputedStyle(n);
        if (style.display === "none" || style.visibility === "hidden")
          return true;
      }
    }
    return false;
  };
  const dialogs = [
    ...document.querySelectorAll('dialog,[role="dialog"],[aria-modal="true"]'),
  ].filter((n, i, a) => a.indexOf(n) === i);
  const visibleDialogs = dialogs.filter((n) => !hidden(n));
  const lastVisibleDialog = visibleDialogs.at(-1);
  const selector = {
    title: 'title,meta,h1,h2,h3,[role="heading"],img[alt]',
    image: "meta,img,video[poster]",
    description:
      'meta,p,[aria-label],[itemprop="description"],[class*="synopsis" i],[class*="summary" i],[class*="description" i]',
  };
  const nodeValue = (node, attribute, field) => {
    if (attribute === "text") {
      if (field === "title" && node.tagName === "H1") {
        const direct = [...node.childNodes]
          .filter((n) => n.nodeType === 3)
          .map((n) => n.textContent)
          .join(" ");
        return direct || node.textContent;
      }
      return node.textContent;
    }
    if (attribute === "src")
      return (
        node.currentSrc ||
        node.getAttribute("src") ||
        node.getAttribute("data-src")
      );
    if (node.tagName === "META") return node.getAttribute("content");
    return node.getAttribute(attribute);
  };
  const rawMatch = (node, candidate, original, field) => {
    if (node.tagName.toLowerCase() !== original.tag) return false;
    if (
      node.tagName === "META" &&
      (node.getAttribute("property") || node.getAttribute("name")) !==
        original.attribute
    )
      return false;
    const value = nodeValue(node, original.attribute, field);
    if (field === "image") return safeUrl(value) === safeUrl(candidate.value);
    return (
      clean(value, field === "description" ? 160 : 180) === candidate.value
    );
  };
  const numeric = (value) =>
    Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
  const semantic = (n) => ({
    tag: n.tagName.toLowerCase(),
    ...(n.getAttribute("role")
      ? { role: clean(n.getAttribute("role"), 40) }
      : {}),
    ...(n.getAttribute("aria-label")
      ? { label: clean(n.getAttribute("aria-label"), 80) }
      : {}),
  });
  const extra = (node) => {
    const rect =
      typeof node.getBoundingClientRect === "function"
        ? node.getBoundingClientRect()
        : null;
    const ancestor = [];
    for (
      let n = node.parentElement;
      n && ancestor.length < 4;
      n = n.parentElement
    )
      ancestor.push(semantic(n));
    let nearbyHeadings = [];
    for (
      let n = node.parentElement, depth = 0;
      n && depth < 5;
      n = n.parentElement, depth++
    ) {
      const headings = [...n.querySelectorAll('h1,h2,h3,[role="heading"]')]
        .filter((h) => h !== node && !h.contains(node))
        .slice(0, 2)
        .map((h) => clean(h.textContent, 100))
        .filter(Boolean);
      if (headings.length) {
        nearbyHeadings = headings;
        break;
      }
    }
    const dialog = node.closest('dialog,[role="dialog"],[aria-modal="true"]');
    const anchor = node.closest("a[href]");
    return {
      alt: clean(node.getAttribute("alt"), 140) || null,
      title: clean(node.getAttribute("title"), 140) || null,
      width: numeric(node.getAttribute("width")),
      height: numeric(node.getAttribute("height")),
      naturalWidth: numeric(node.naturalWidth),
      naturalHeight: numeric(node.naturalHeight),
      renderedWidth: rect ? numeric(Math.round(rect.width)) : null,
      renderedHeight: rect ? numeric(Math.round(rect.height)) : null,
      parentRoles: ancestor,
      nearbyHeadings,
      href: anchor ? safeUrl(anchor.getAttribute("href")) : null,
      inDialog: !!dialog,
      dialogIndex: dialog ? dialogs.indexOf(dialog) : null,
      inLastVisibleDialogInDom:
        !!lastVisibleDialog && lastVisibleDialog.contains(node),
      inert: !!node.closest("[inert]"),
      region: semantic(
        node.closest(
          'main,article,section,nav,footer,header,dialog,[role="dialog"]',
        ) || document.documentElement,
      ),
      enrichmentMatched: true,
      enrichmentMatch: "exactPathAndValue",
    };
  };
  const fields = {};
  for (const field of Object.keys(snapshot.fields)) {
    const nodes = [...document.querySelectorAll(selector[field])];
    fields[field] = snapshot.fields[field].map((candidate) => ({
      ...candidate,
      nodes: candidate.nodes.map((original) => {
        const matching = nodes.filter((n) =>
          rawMatch(n, candidate, original, field),
        );
        const exact = matching.filter((n) => path(n) === original.path);
        const matched = exact.length === 1 ? exact[0] : null;
        return {
          ...original,
          ...(matched
            ? extra(matched)
            : {
                enrichmentMatched: false,
                enrichmentMatch:
                  exact.length > 1
                    ? "ambiguousPathAndValue"
                    : matching.length
                      ? "sameValueWithoutExactPath"
                      : "notFound",
              }),
        };
      }),
    }));
  }
  return {
    ...snapshot,
    fields,
    pageEvidence: {
      url: safeUrl(pageUrl),
      documentTitle: clean(document.title),
      headings: [
        ...document.querySelectorAll('h1,[role="heading"][aria-level="1"]'),
      ]
        .slice(0, 8)
        .map((n) => ({ text: clean(n.textContent, 140), hidden: hidden(n) })),
      visibleDialogCount: visibleDialogs.length,
      dialogs: dialogs
        .slice(0, 6)
        .map((n, index) => ({
          index,
          tag: n.tagName.toLowerCase(),
          open: n.hasAttribute("open"),
          ariaModal: n.getAttribute("aria-modal"),
          hidden: hidden(n),
          lastVisibleInDom: n === lastVisibleDialog,
          headings: [...n.querySelectorAll("h1,h2,h3")]
            .slice(0, 2)
            .map((h) => clean(h.textContent, 100)),
        })),
      bodyPrefix: clean(bodyTexts.join(" "), 180),
    },
    enrichment: {
      version: 2,
      computedLayout: !!document.defaultView?.getComputedStyle,
      selection:
        "Same bounded v1 candidates; enrichment never adds/removes/reorders candidates",
    },
  };
}
