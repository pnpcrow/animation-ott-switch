import { describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { collectWorkLinkEvidence } from "../src/providers/dom-links";

const page = "https://ott.example/search?q=witch";
const doc = (body: string) =>
  parseHTML(`<html><body><main>${body}</main></body></html>`)
    .document as unknown as Document;
const plain = (value: ReturnType<typeof collectWorkLinkEvidence>) =>
  value.candidates.map(({ element: _element, ...candidate }) => candidate);

describe("bounded local work-link evidence", () => {
  it("reads anchor and declared targets with only their local structure", () => {
    const document = doc(
      `<article class="work-card"><h3>어느 마녀가 죽을 때까지</h3><a class="poster-link" href="/series/witch"><img alt="어느 마녀가 죽을 때까지"></a><p>마녀의 이야기</p></article><div data-href="/detail/another">Another</div><div data-url="?modal=77">Modal</div>`,
    );
    const result = collectWorkLinkEvidence(document, page);
    expect(result.candidates.map((candidate) => candidate.url)).toEqual([
      "https://ott.example/series/witch",
      "https://ott.example/detail/another",
      "https://ott.example/search?modal=77",
    ]);
    const first = result.candidates[0];
    expect(first.label).toBe("어느 마녀가 죽을 때까지");
    expect(first.workHint).toBe(true);
    expect(first.context.parent?.tag).toBe("article");
    expect(first.context.previous?.text).toBe("어느 마녀가 죽을 때까지");
    expect(first.context.next?.text).toBe("마녀의 이야기");
    expect(first.requiresVerification).toBe(true);
    expect(first.element).toBe(document.querySelector("a"));
  });

  it.each([
    "location.href = '/title/123';",
    "window.location='/title/123'",
    "document.location.href='/title/123'; return false;",
    "location.assign('/title/123')",
    "return window.location.replace('/title/123');",
    "window.open('/title/123', '_blank'); return false;",
  ])(
    "reads a strictly literal inline destination without execution: %s",
    (handler) => {
      const document = doc(`<button>Work</button>`),
        button = document.querySelector("button")!;
      button.setAttribute("onclick", handler);
      const clicked = vi.fn();
      button.addEventListener("click", clicked);
      Object.defineProperty(button, "onclick", {
        get() {
          throw new Error("Must not inspect function properties");
        },
      });
      const result = collectWorkLinkEvidence(document, page);
      expect(result.candidates[0]).toMatchObject({
        source: "onclick",
        status: "url",
        url: "https://ott.example/title/123",
      });
      expect(clicked).not.toHaveBeenCalled();
    },
  );

  it.each([
    "router.push('/title/' + workId)",
    "location.href = getWorkUrl()",
    "if (ready) location.href = '/title/1'",
    "location.assign(`/title/${workId}`)",
    "window.open('/title/' + workId)",
    "event.preventDefault(); location.assign('/title/1')",
    "openWork(123)",
  ])(
    "preserves an unresolved action instead of inventing a URL: %s",
    (handler) => {
      const document = doc(
        `<a href="javascript:void(0)" role="button">Work</a>`,
      );
      document.querySelector("a")!.setAttribute("onclick", handler);
      const result = collectWorkLinkEvidence(document, page);
      expect(result.candidates[0]).toMatchObject({
        source: "onclick",
        status: "unknown",
        reason: "script-target-not-literal",
      });
      expect(result.candidates[0].url).toBeUndefined();
      expect(JSON.stringify(plain(result))).not.toContain(handler);
    },
  );

  it("does not scrape scripts or infer routes from opaque DOM action names", () => {
    const document = doc(
      `<script>window.route='/title/secret'</script><button data-action="showWork">Work</button><a href="javascript:void(0)">Other</a>`,
    );
    Object.defineProperty(document.querySelector("script"), "textContent", {
      get() {
        throw new Error("Script scraping is forbidden");
      },
    });
    const result = collectWorkLinkEvidence(document, page);
    expect(result.candidates).toHaveLength(2);
    expect(
      result.candidates.every(
        (candidate) => candidate.status === "unknown" && !candidate.url,
      ),
    ).toBe(true);
    expect(JSON.stringify(plain(result))).not.toContain("secret");
  });

  it("does not claim a fallback href is the destination of an overriding handler", () => {
    const document = doc(
      `<a href="/title/fallback" onclick="location.assign('/title/actual')">Actual</a><a href="/title/fallback" onclick="route(workId)">Unknown</a>`,
    );
    const result = collectWorkLinkEvidence(document, page);
    expect(result.candidates[0]).toMatchObject({
      source: "onclick",
      status: "url",
      url: "https://ott.example/title/actual",
    });
    expect(result.candidates[1]).toMatchObject({
      source: "onclick",
      status: "unknown",
    });
    expect(result.candidates[1].url).toBeUndefined();
  });

  it("excludes navigation, hidden scopes, state-changing targets and private parameters", () => {
    const document = doc(
      `<nav><a href="/series/menu">Menu</a></nav><div hidden><a href="/series/hidden">Hidden</a></div><div inert><button>Inert</button></div><a href="/logout">Exit</a><button data-url="/purchase/1">Buy now</button><a href="/title/1" download>File</a><a href="/title/2?access_token=private">Private</a><a href="https://user:pass@ott.example/title/3">Credential</a><a href="javascript:alert(1)">Executable</a><a href="data:text/html,test">Data</a><a href="/title/4" aria-disabled="true">Disabled</a><a href="/title/5?programId=123&modal=456">Good</a>`,
    );
    expect(
      collectWorkLinkEvidence(document, page).candidates.map(
        (candidate) => candidate.url,
      ),
    ).toEqual(["https://ott.example/title/5?programId=123&modal=456"]);
    expect(
      collectWorkLinkEvidence(document.querySelector("[hidden]")!, page)
        .candidates,
    ).toEqual([]);
  });

  it("keeps episode clues and unrelated links as hints, not verified works", () => {
    const document = doc(
      `<article class="episode-card"><a href="/series/one/episode/2">2화</a></article><a href="https://help.example/about">About</a>`,
    );
    const result = collectWorkLinkEvidence(document, page);
    expect(result.candidates[0]).toMatchObject({
      workHint: true,
      episodeHint: true,
      requiresVerification: true,
    });
    expect(result.candidates[1]).toMatchObject({
      workHint: false,
      sameOrigin: false,
      requiresVerification: true,
    });
  });

  it("preserves only GET form endpoints and never collects form input values", () => {
    const document = doc(
      `<form action="/search"><input value="private" name="token"><label>Work search</label></form><form action="/submit" method="post"><input value="private"><button>Submit</button></form>`,
    );
    const result = collectWorkLinkEvidence(document, page);
    expect(result.candidates.map((candidate) => candidate.url)).toEqual([
      "https://ott.example/search",
    ]);
    expect(JSON.stringify(plain(result))).not.toContain("private");
    expect(result.candidates[0].workHint).toBe(false);
  });

  it("retains legitimate title text in URLs while rejecting control characters", () => {
    const document = doc(
      `<a href="/title/어느 마녀가 죽을 때까지">Work</a><a href="/title/unsafe&#10;url">Unsafe</a>`,
    );
    const result = collectWorkLinkEvidence(document, page);
    expect(result.candidates).toHaveLength(1);
    expect(decodeURI(result.candidates[0].url!)).toBe(
      "https://ott.example/title/어느 마녀가 죽을 때까지",
    );
  });

  it("bounds node visits and candidate count even on a large page", () => {
    const document = doc(
      `${"<div><span>Noise</span></div>".repeat(2000)}<a href="/title/end">Last</a>`,
    );
    const bounded = collectWorkLinkEvidence(document, page, { maxVisited: 12 });
    expect(bounded.visited).toBeLessThanOrEqual(12);
    expect(bounded.truncated).toBe(true);
    expect(bounded.candidates).toEqual([]);
    const many = doc(
      Array.from(
        { length: 100 },
        (_, i) => `<a href="/title/${i}">Work ${i}</a>`,
      ).join(""),
    );
    const capped = collectWorkLinkEvidence(many, page, {
      maxCandidates: 2,
      maxVisited: 100,
    });
    expect(capped.candidates).toHaveLength(2);
    expect(capped.visited).toBeLessThanOrEqual(100);
    expect(capped.truncated).toBe(true);
    expect(collectWorkLinkEvidence(many, page, { maxVisited: 0 }).visited).toBe(
      0,
    );
  });

  it("bounds neighborhood text and never leaves the requested element scope", () => {
    const huge = "Long content ".repeat(10000);
    const document = doc(
      `<h1>Outside scope title</h1><a href="/title/one" class="${"long-class ".repeat(10000)}">${huge}</a><p>Outside scope description</p>`,
    );
    const result = collectWorkLinkEvidence(document.querySelector("a")!, page, {
      maxVisited: 20,
    });
    const item = result.candidates[0];
    expect(item.context.self.text.length).toBeLessThanOrEqual(100);
    expect(item.context.self.textTruncated).toBe(true);
    expect(item.context.self.classes.length).toBeLessThanOrEqual(4);
    expect(item.context.parent).toBeUndefined();
    expect(item.context.previous).toBeUndefined();
    expect(item.context.next).toBeUndefined();
    expect(JSON.stringify(plain(result))).not.toContain("Outside scope");
    expect(result.visited).toBeLessThanOrEqual(20);
  });

  it("distinguishes whitespace normalization from actual title clipping", () => {
    const document = doc(
      `<button data-url="/title/one">\n  <h3> Work title </h3>\n</button><button data-url="/title/two"><img alt="${"A".repeat(150)}"></button>`,
    );
    const result = collectWorkLinkEvidence(document, page);
    expect(result.candidates[0].context.self).toMatchObject({
      text: "Work title",
      textTruncated: false,
    });
    expect(result.candidates[1].context.self.textTruncated).toBe(true);
  });
});
