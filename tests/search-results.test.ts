import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import {
  isSearchUrl,
  readSearchResults,
} from "../src/providers/search-results";
import { providers } from "../src/providers/identity";
import type { ProviderId } from "../src/core/types";

const documentFor = (body: string, title = "검색") =>
  parseHTML(
    `<html><head><title>${title}</title></head><body>${body}</body></html>`,
  ).document as unknown as Document;
const search = (provider: ProviderId, body: string, title = "검색") =>
  readSearchResults(
    documentFor(body, title),
    provider,
    providers.find((p) => p.id === provider)!.searchUrl("장송의 프리렌"),
  );

describe("rendered official search pages", () => {
  it.each(
    providers.map(
      (provider) => [provider.id, provider.searchUrl("A&B")] as const,
    ),
  )("accepts %s encoded search URL", (provider, url) => {
    expect(isSearchUrl(provider, url)).toBe(true);
  });
  it.each([
    ["netflix", "https://www.netflix.com/search?q=A&jbv=123"],
    ["netflix", "https://www.netflix.com.evil.example/search?q=A"],
    ["netflix", "https://www.netflix.com/search"],
    ["netflix", "https://www.netflix.com/watch/123"],
    ["laftel", "https://laftel.net/item/41666"],
    ["laftel", "https://laftel.net/search?keyword=프리렌&modal=41666"],
  ])("rejects a non-search or mismatched URL: %s %s", (provider, url) => {
    expect(isSearchUrl(provider as ProviderId, url)).toBe(false);
  });
  it("does not read the background search grid while a Laftel detail modal is open", () => {
    const document = documentFor(
      '<main><a href="/item/1"><h3>이전 검색 결과</h3></a></main><section role="dialog"><h1>새 작품</h1></section>',
    );
    expect(
      readSearchResults(
        document,
        "laftel",
        "https://laftel.net/search?keyword=이전&modal=2",
      ),
    ).toMatchObject({ candidates: [], complete: false });
  });
  it("resolves Laftel's real search modal anchors to a stable title modal URL", () => {
    const result = search(
      "laftel",
      '<main><article><a href="/search?keyword=%ED%94%84%EB%A6%AC%EB%A0%8C&amp;modal=41666"><img alt="(자막) 장송의 프리렌"></a><a href="/?modal=41666">자세히 보기</a></article></main>',
    );
    expect(result.candidates).toEqual([
      { title: "장송의 프리렌", url: "https://laftel.net/?modal=41666" },
    ]);
  });
  it("waits for JS hydration and then reads actual Netflix search cards", () => {
    const document = documentFor(
      '<main class="search"><div class="galleryContent"></div></main>',
    );
    const url = "https://www.netflix.com/search?q=Frieren";
    expect(readSearchResults(document, "netflix", url)).toMatchObject({
      candidates: [],
      complete: false,
    });
    document.querySelector(".galleryContent")!.innerHTML =
      `<div class="title-card"><a href="/watch/81726714?trackId=123" aria-label="Watch 장송의 프리렌"><img alt="장송의 프리렌" src="https://images.example/poster.jpg"></a><a href="/title/81726714">More info</a></div>`;
    expect(readSearchResults(document, "netflix", url).candidates).toEqual([
      { title: "장송의 프리렌", url: "https://www.netflix.com/title/81726714" },
    ]);
  });
  it("does not treat arbitrary playback or episode links as series results", () => {
    const result = search(
      "netflix",
      `<main><a href="/watch/123"><img alt="장송의 프리렌"></a><div class="title-card"><div class="episodeSelector"><a href="/watch/456"><img alt="장송의 프리렌"></a></div></div><div class="title-card"><a href="/title/789"><span class="fallback-text">장송의 프리렌</span></a></div></main>`,
    );
    expect(result.candidates).toEqual([
      { title: "장송의 프리렌", url: "https://www.netflix.com/title/789" },
    ]);
  });
  it("prefers title evidence over action labels and duplicated badges", () => {
    const result = search(
      "laftel",
      `<main><article><a href="/item/41666/slug"><img alt="(자막) 장송의 프리렌"></a><a href="/item/41666" aria-label="재생"><span class="badge">15세</span></a></article><article><a href="/item/41667"><h3>장송의 프리렌 2기</h3><span class="metadata">2026 · 애니메이션</span></a></article></main>`,
    );
    expect(result.candidates).toEqual([
      { title: "장송의 프리렌", url: "https://laftel.net/item/41666" },
      { title: "장송의 프리렌 2기", url: "https://laftel.net/item/41667" },
    ]);
    expect(result.complete).toBe(false);
  });
  it("extracts Apple and Crunchyroll title evidence without returning search or episode links", () => {
    expect(
      search(
        "apple",
        `<main><a data-testid="search-card-lockup" href="/kr/show/frieren/umc.cmc.123"><div class="search-card-title">장송의 프리렌</div><p>TV 프로그램</p></a></main>`,
      ).candidates,
    ).toEqual([
      {
        title: "장송의 프리렌",
        url: "https://tv.apple.com/kr/show/frieren/umc.cmc.123",
      },
    ]);
    expect(
      search(
        "crunchyroll",
        `<main><article><a href="/ko/series/G123/frieren" title="Watch 장송의 프리렌"><img alt="장송의 프리렌"></a></article><a href="/ko/watch/EP123/frieren">장송의 프리렌</a></main>`,
      ).candidates,
    ).toEqual([
      {
        title: "장송의 프리렌",
        url: "https://www.crunchyroll.com/series/G123",
      },
    ]);
  });
  it.each([
    ["aniplus", "/items/1234", "https://www.aniplustv.com/items/1234"],
    [
      "prime",
      "/-/ko/detail/0L9GBGL4H77KZZSPBGVW5PEIGB",
      "https://www.primevideo.com/detail/0L9GBGL4H77KZZSPBGVW5PEIGB",
    ],
    [
      "wavve",
      "/player/vod?contentid=M_EP20230101.1",
      "https://www.wavve.com/player/vod?contentid=M_EP20230101.1",
    ],
    [
      "tving",
      "/contents/M000359644",
      "https://www.tving.com/contents/M000359644",
    ],
    [
      "coupang",
      "/content/42c2067a-4c16-4dfe-b416-736578115ecf",
      "https://www.coupangplay.com/content/42c2067a-4c16-4dfe-b416-736578115ecf",
    ],
    [
      "watcha",
      "/ko/contents/tR4x71d",
      "https://watcha.com/ko/contents/tR4x71d",
    ],
  ])("reads a rendered %s official detail card", (provider, href, url) => {
    const result = search(
      provider as ProviderId,
      `<main><article class="content-card"><a href="${href}"><img alt="장송의 프리렌"></a></article></main>`,
    );
    expect(result.candidates).toEqual([{ title: "장송의 프리렌", url }]);
  });
  it("ignores hidden, recommendation, navigation and external-host links", () => {
    const result = search(
      "tving",
      `<main><div hidden><a href="/contents/M1">숨김</a></div><div style="display: none"><a href="/contents/M2">숨김</a></div><section aria-label="추천 작품"><a href="/contents/M3">추천</a></section><a href="https://www.tving.com.evil.test/contents/M4">외부</a><a href="javascript:alert(1)">코드</a></main><nav><a href="/contents/M5">메뉴</a></nav>`,
    );
    expect(result.candidates).toEqual([]);
    expect(result.complete).toBe(false);
  });
  it("treats explicit empty results as exhaustive but ignores hidden empty placeholders", () => {
    expect(
      search(
        "watcha",
        '<main><p class="search-page__error-message">검색 결과가 없습니다.</p><a href="/kr/show/recommend/umc.cmc.123">추천작</a></main>',
      ),
    ).toMatchObject({ candidates: [], complete: true });
    expect(
      search(
        "netflix",
        '<main><p data-uia="search-no-results">Your search for "Frieren" did not have any matches.</p></main>',
      ),
    ).toMatchObject({ candidates: [], complete: true });
    expect(
      search(
        "apple",
        '<p class="search-page__error-message" hidden>검색 결과가 없습니다.</p>',
      ),
    ).toMatchObject({ candidates: [], complete: false });
  });
  it("reports login/challenge as blocked rather than empty", () => {
    expect(search("netflix", "<h1>로그인</h1>", "Netflix")).toMatchObject({
      candidates: [],
      complete: false,
      blocked: true,
    });
    expect(
      search(
        "crunchyroll",
        '<div id="challenge-running">Checking browser</div>',
        "Just a moment...",
      ),
    ).toMatchObject({ complete: false, blocked: true });
    expect(
      readSearchResults(
        documentFor(""),
        "netflix",
        "https://www.netflix.com/login?next=search",
      ),
    ).toMatchObject({ complete: false, blocked: true });
    expect(
      search("netflix", "<div hidden><h2>로그인</h2></div>"),
    ).toMatchObject({ complete: false });
  });
  it("waits through SPA loading before accepting cards or stale empty text", () => {
    const document = documentFor(
      '<main aria-busy="true"><p class="no-results">검색 결과가 없습니다.</p><a href="/contents/M123"><h3>장송의 프리렌</h3></a></main>',
    );
    const url = "https://www.tving.com/search?keyword=프리렌";
    expect(readSearchResults(document, "tving", url)).toMatchObject({
      candidates: [],
      complete: false,
      loading: true,
    });
    document.querySelector("main")!.removeAttribute("aria-busy");
    document.querySelector(".no-results")!.remove();
    expect(readSearchResults(document, "tving", url).candidates).toEqual([
      { title: "장송의 프리렌", url: "https://www.tving.com/contents/M123" },
    ]);
  });
  it("does not certify a first title while its duplicate version is still hydrating", () => {
    const document = documentFor(
      '<main><section aria-busy="true"><a href="/item/1"><h3>(자막) 장송의 프리렌</h3></a></section></main>',
    );
    const url = "https://laftel.net/search?keyword=프리렌";
    expect(readSearchResults(document, "laftel", url)).toMatchObject({
      loading: true,
      candidates: [],
    });
    document.querySelector("section")!.innerHTML +=
      '<a href="/item/2"><h3>(더빙) 장송의 프리렌</h3></a>';
    expect(readSearchResults(document, "laftel", url)).toMatchObject({
      loading: true,
      candidates: [],
    });
    document.querySelector("section")!.removeAttribute("aria-busy");
    expect(
      readSearchResults(document, "laftel", url).candidates.map(
        (candidate) => candidate.url,
      ),
    ).toEqual(["https://laftel.net/item/1", "https://laftel.net/item/2"]);
  });
  it("reads bounded JSON-LD ItemList without evaluating code or accepting arbitrary links", () => {
    const data = {
      "@type": "ItemList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          item: {
            "@type": "TVSeries",
            name: "장송의 프리렌",
            url: "/contents/M123",
            datePublished: "2023-09-29",
          },
        },
        { item: { name: "외부", url: "https://evil.test/contents/M456" } },
      ],
    };
    const result = search(
      "tving",
      `<script type="application/ld+json">${JSON.stringify(data)}</script><script type="application/ld+json">window.wasExecuted=true</script>`,
    );
    expect(result.candidates).toEqual([
      {
        title: "장송의 프리렌",
        url: "https://www.tving.com/contents/M123",
        year: 2023,
      },
    ]);
    expect(result.complete).toBe(false);
  });
});
