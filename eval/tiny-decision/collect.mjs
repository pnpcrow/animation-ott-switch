// Generic bounded DOM observation. This collector never knows the annotated answer.
// It retains hidden/navigation distractors rather than preselecting a provider adapter's answer.
export function collectDomSnapshot(document, pageUrl) {
  const clean = (s, max = 220) =>
    String(s || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max);
  const https = (value) => {
    if (typeof value !== "string" || !value.trim() || value.startsWith("#"))
      return "";
    try {
      const u = new URL(value, pageUrl);
      return u.protocol === "https:" && !u.username && !u.password
        ? u.href
        : "";
    } catch {
      return "";
    }
  };
  const label = (node) => {
    const result = { tag: node.tagName.toLowerCase() };
    for (const key of ["role", "aria-label", "aria-modal", "itemprop"])
      if (node.getAttribute(key))
        result[key] = clean(node.getAttribute(key), 70);
    const classes = clean(node.getAttribute("class"), 130);
    if (classes) result.class = classes;
    return result;
  };
  const state = (node) => {
    let hidden = false;
    for (let n = node; n; n = n.parentElement) {
      if (
        n.hasAttribute("hidden") ||
        n.getAttribute("aria-hidden") === "true" ||
        /display\s*:\s*none|visibility\s*:\s*hidden/i.test(
          n.getAttribute("style") || "",
        )
      )
        hidden = true;
      const view = document.defaultView;
      if (view?.getComputedStyle) {
        const style = view.getComputedStyle(n);
        if (style.display === "none" || style.visibility === "hidden")
          hidden = true;
      }
    }
    const navigation = !!node.closest("nav,footer,[role=navigation]");
    return { hidden, navigation };
  };
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
  const fields = { title: [], image: [], description: [] };
  const add = (kind, node, value, attribute) => {
    value =
      kind === "image"
        ? https(value)
        : clean(value, kind === "description" ? 160 : 180);
    if (!value || value.length > 2000) return;
    const observation = {
      path: path(node),
      ...label(node),
      ...state(node),
      attribute,
    };
    observation.parents = [];
    for (
      let n = node.parentElement;
      n && observation.parents.length < 3;
      n = n.parentElement
    )
      observation.parents.push(label(n));
    const prev = node.previousElementSibling;
    if (prev && !/SCRIPT|STYLE|NOSCRIPT/.test(prev.tagName))
      observation.previous = clean(prev.textContent, 80);
    const next = node.nextElementSibling;
    if (next && !/SCRIPT|STYLE|NOSCRIPT/.test(next.tagName))
      observation.next = clean(next.textContent, 80);
    const old = fields[kind].find((x) => x.value === value);
    if (old) {
      if (old.nodes.length < 3) old.nodes.push(observation);
      return;
    }
    fields[kind].push({ value, nodes: [observation] });
  };
  if (document.querySelector("title"))
    add("title", document.querySelector("title"), document.title, "text");
  for (const meta of document.querySelectorAll("meta")) {
    const key =
      meta.getAttribute("property") || meta.getAttribute("name") || "";
    if (/^(?:og:title|twitter:title)$/.test(key))
      add("title", meta, meta.getAttribute("content"), key);
    if (/^(?:og:image|twitter:image)$/.test(key))
      add("image", meta, meta.getAttribute("content"), key);
    if (/^(?:og:description|description|twitter:description)$/.test(key))
      add("description", meta, meta.getAttribute("content"), key);
  }
  for (const node of [
    ...document.querySelectorAll("h1,[role=heading][aria-level='1']"),
  ].slice(0, 12)) {
    const direct = [...node.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent)
      .join(" ");
    add("title", node, direct || node.textContent, "text");
    for (const image of node.querySelectorAll("img[alt]"))
      add("title", image, image.getAttribute("alt"), "alt");
  }
  for (const node of [
    ...document.querySelectorAll("h2,h3,[role=heading]"),
  ].slice(0, 10))
    add("title", node, node.textContent, "text");
  for (const node of [
    ...document.querySelectorAll("img[alt],video[poster]"),
  ].slice(0, 100)) {
    if (node.tagName === "IMG") {
      if (
        (Number(node.getAttribute("width")) > 0 &&
          Number(node.getAttribute("width")) <= 2) ||
        /(?:^|\.)fls-[^/]+\.amazon\.com/.test(node.getAttribute("src") || "")
      )
        continue;
      add("title", node, node.getAttribute("alt"), "alt");
      add(
        "image",
        node,
        node.currentSrc ||
          node.getAttribute("src") ||
          node.getAttribute("data-src"),
        "src",
      );
    } else add("image", node, node.getAttribute("poster"), "poster");
  }
  for (const node of [
    ...document.querySelectorAll(
      "p,[aria-label],[itemprop=description], [class*='synopsis' i], [class*='summary' i], [class*='description' i]",
    ),
  ].slice(0, 600)) {
    const value = node.getAttribute("aria-label") || node.textContent;
    if (clean(value, 500).length < 35) continue;
    if (node.querySelector("p") && !node.hasAttribute("aria-label")) continue;
    add(
      "description",
      node,
      value,
      node.hasAttribute("aria-label") ? "aria-label" : "text",
    );
  }
  // Bound by semantic source order, never by annotated title or expected selector.
  for (const kind of Object.keys(fields))
    fields[kind] = fields[kind]
      .slice(0, 18)
      .map((row, i) => ({ id: `${kind[0]}${i + 1}`, ...row }));
  return { pageUrl, documentTitle: clean(document.title), fields };
}
