import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import {
  canonicalizeProviderUrl,
  detectProvider,
  extractPage,
  isDetailUrl,
  matchCandidates,
  normalizeTitle,
  parseSearchHtml,
  providers,
  providerTitleId,
  safeProviderUrl,
  searchProvider,
} from "../src/providers";
import type { PageTitle, ProviderId } from "../src/core/types";

const page: PageTitle = {
  provider: "netflix",
  title: "장송의 프리렌",
  aliases: ["Frieren: Beyond Journey’s End"],
  url: "https://www.netflix.com/title/81726714",
  description: "설명",
  imageUrl: "",
};
const doc = (html: string) => parseHTML(html).document as unknown as Document;
const fixture = (name: string) =>
  readFileSync(
    new URL(`./fixtures/providers/${name}`, import.meta.url),
    "utf8",
  );
afterEach(() => vi.unstubAllGlobals());

describe("provider identity and safety", () => {
  it.each([
    ["laftel", "https://laftel.net/item/41666/name", "41666"],
    [
      "netflix",
      "https://www.netflix.com/kr/title/81726714?trackId=1",
      "81726714",
    ],
    ["netflix", "https://www.netflix.com/browse?jbv=81726714", "81726714"],
    [
      "apple",
      "https://tv.apple.com/kr/show/name/umc.cmc.5iswprrvjjw6ab020a17x4ca3",
      "umc.cmc.5iswprrvjjw6ab020a17x4ca3",
    ],
    [
      "crunchyroll",
      "https://www.crunchyroll.com/ko/series/GR751KNZY/attack-on-titan",
      "GR751KNZY",
    ],
    ["aniplus", "https://www.aniplustv.com/items/1234", "1234"],
    [
      "prime",
      "https://www.primevideo.com/-/ko/detail/0L9GBGL4H77KZZSPBGVW5PEIGB",
      "0L9GBGL4H77KZZSPBGVW5PEIGB",
    ],
    [
      "wavve",
      "https://www.wavve.com/player/vod?contentid=M_EP20230101.1",
      "M_EP20230101.1",
    ],
    ["tving", "https://www.tving.com/contents/M000359644", "M000359644"],
    [
      "coupang",
      "https://www.coupangplay.com/content/42c2067a-4c16-4dfe-b416-736578115ecf",
      "42c2067a-4c16-4dfe-b416-736578115ecf",
    ],
    ["watcha", "https://watcha.com/ko/contents/tR4x71d", "tR4x71d"],
  ])("identifies %s detail pages", (provider, url, id) => {
    expect(detectProvider(url)).toBe(provider);
    expect(providerTitleId(url)).toBe(id);
    expect(safeProviderUrl(provider as ProviderId, url)).toBe(true);
    expect(canonicalizeProviderUrl(url)).not.toContain("trackId");
  });
  it("has ten official providers and encoded search URLs", () => {
    expect(providers).toHaveLength(10);
    for (const provider of providers) {
      const searchUrl = provider.searchUrl("A&B #?");
      expect(detectProvider(searchUrl)).toBe(provider.id);
      expect(searchUrl).toContain("A%26B%20%23%3F");
      expect(isDetailUrl(searchUrl)).toBe(false);
    }
  });
  it.each([
    "https://www.netflix.com/watch/81726714",
    "https://www.crunchyroll.com/watch/G123/name",
    "https://laftel.net/search?keyword=title",
    "https://www.netflix.com.evil.test/title/123",
    "https://user:pass@www.netflix.com/title/123",
    "http://laftel.net/item/123",
    "javascript:alert(1)",
    "https://www.netflix.com:444/title/123",
    "https://www.tving.com/player/E123",
    "https://pedia.watcha.com/ko/contents/123",
  ])("rejects non-detail or unsafe link %s", (url) =>
    expect(isDetailUrl(url)).toBe(false),
  );
  it("normalizes presentation without conflating seasons", () => {
    expect(normalizeTitle("(자막) 장송의 프리렌")).toBe(
      normalizeTitle("장송의 프리렌"),
    );
    expect(normalizeTitle("장송의 프리렌 2기")).not.toBe(
      normalizeTitle("장송의 프리렌"),
    );
    expect(normalizeTitle("Re:ZERO Season 2")).not.toBe(
      normalizeTitle("Re:ZERO Season 1"),
    );
    expect(normalizeTitle("Watch Dogs")).not.toBe(normalizeTitle("Dogs"));
  });
});

describe("page metadata extraction", () => {
  it.each([
    ["laftel-detail.html", "https://laftel.net/item/41666", "장송의 프리렌"],
    [
      "netflix-detail.html",
      "https://www.netflix.com/kr/title/81726714",
      "장송의 프리렌",
    ],
    [
      "tving-detail.html",
      "https://www.tving.com/contents/M000359644",
      "제폭 : 범죄와의 전쟁",
    ],
  ])(
    "extracts minimized live official metadata from %s",
    (name, url, title) => {
      const extracted = extractPage(doc(fixture(name)), url);
      expect(extracted?.title).toBe(title);
      expect(extracted?.description.length).toBeGreaterThan(20);
      expect(extracted?.imageUrl).toMatch(/^https:\/\//);
    },
  );
  it("prefers real Laftel OG title to its generic JSON-LD name", () => {
    const document = doc(
      `<html><head><title>(자막) 장송의 프리렌 라프텔 - 애니 추천 애니 스트리밍 서비스</title><meta property="og:title" content="(자막) 장송의 프리렌 ㅣ 라프텔"><meta property="og:description" content="오래 사는 마법사의 여행"><meta property="og:image" content="https://thumbnail.laftel.net/test.jpg"><script type="application/ld+json">{"@type":"TVSeason","name":"라프텔 - 애니 추천 애니 스트리밍 서비스"}</script></head></html>`,
    );
    expect(
      extractPage(document, "https://laftel.net/item/41666"),
    ).toMatchObject({
      title: "장송의 프리렌",
      description: "오래 사는 마법사의 여행",
      imageUrl: "https://thumbnail.laftel.net/test.jpg",
    });
  });
  it("reads structured title/year, sanitizes image URLs, and does not execute markup", () => {
    const document = doc(
      '<html><head><script type="application/ld+json">{"@type":"TVSeries","name":"장송의 프리렌","datePublished":"2023-09-29","image":"javascript:alert(1)","description":"<img onerror=alert(1)>"}</script></head></html>',
    );
    expect(extractPage(document, page.url)).toMatchObject({
      title: page.title,
      year: 2023,
      imageUrl: "",
      description: "<img onerror=alert(1)>",
    });
  });
  it("extracts Netflix browse modal and refuses browse page OG metadata", () => {
    expect(
      extractPage(
        doc(
          '<html><head><meta property="og:title" content="Netflix"></head></html>',
        ),
        "https://www.netflix.com/browse?jbv=123",
      ),
    ).toBeNull();
    const document = doc(
      '<html><head><meta property="og:title" content="Netflix"></head><body><div class="previewModal--container"><img class="previewModal--player-titleTreatment-logo" alt="장송의 프리렌"><p class="previewModal--text">여행 이야기</p></div></body></html>',
    );
    expect(
      extractPage(document, "https://www.netflix.com/browse?jbv=123"),
    ).toMatchObject({
      title: page.title,
      url: "https://www.netflix.com/title/123",
      description: "여행 이야기",
    });
  });
  it.each([
    '<link rel="canonical" href="https://laftel.net/item/1">',
    '<meta property="og:url" content="https://laftel.net/item/1">',
  ])("rejects stale SPA metadata %s", (tag) => {
    expect(
      extractPage(
        doc(
          `<html><head>${tag}<meta property="og:title" content="Old title"></head></html>`,
        ),
        "https://laftel.net/item/2",
      ),
    ).toBeNull();
  });
  it("does not show a sidebar on search, player, or generic shell", () => {
    const document = doc(
      "<html><head><title>한일 동시방영 채널 - 애니플러스</title></head></html>",
    );
    expect(
      extractPage(document, "https://www.aniplustv.com/items/123"),
    ).toBeNull();
    expect(
      extractPage(document, "https://laftel.net/search?keyword=test"),
    ).toBeNull();
    expect(
      extractPage(document, "https://www.netflix.com/watch/123"),
    ).toBeNull();
  });
});

describe("conservative catalogue matching", () => {
  it("parses live official Apple search card attributes", () => {
    const parsed = parseSearchHtml(
      "apple",
      fixture("apple-search.html"),
      "https://tv.apple.com/kr/search",
    );
    expect(
      parsed.candidates.some((c) => c.title.includes("The Snoopy Show")),
    ).toBe(true);
  });
  it("does not switch to a sequel, prefix match, or known different year", () => {
    const candidates = [
      { title: "장송의 프리렌 2기", url: "https://laftel.net/item/2" },
      { title: page.title, year: 2020, url: "https://laftel.net/item/3" },
    ];
    expect(
      matchCandidates("laftel", { ...page, year: 2023 }, candidates).status,
    ).toBe("unknown");
  });
  it("finds explicit alternate titles and Apple Korean/English paired titles", () => {
    expect(
      matchCandidates("crunchyroll", page, [
        {
          title: "Frieren: Beyond Journey's End",
          url: "https://www.crunchyroll.com/series/G123/slug",
        },
      ]).status,
    ).toBe("available");
    expect(
      matchCandidates(
        "apple",
        { ...page, title: "더 스누피 쇼", aliases: [] },
        [
          {
            title: "'더 스누피 쇼' - The Snoopy Show",
            url: "https://tv.apple.com/kr/show/name/umc.cmc.123",
          },
        ],
      ).status,
    ).toBe("available");
  });
  it("requires choosing between dub/sub versions and ignores expired versions", () => {
    const candidates = [
      { title: "(자막) 장송의 프리렌", url: "https://laftel.net/item/1" },
      { title: "(더빙) 장송의 프리렌", url: "https://laftel.net/item/2" },
    ];
    expect(matchCandidates("laftel", page, candidates).status).toBe(
      "ambiguous",
    );
    expect(
      matchCandidates(
        "laftel",
        page,
        candidates.map((c) => ({ ...c, expired: true })),
        true,
      ).status,
    ).toBe("unavailable");
    expect(
      matchCandidates("laftel", page, [
        candidates[0],
        { ...candidates[1], expired: true },
      ]).url,
    ).toBe("https://laftel.net/item/1");
  });
  it("does not mark an upcoming title as ready to watch", () => {
    const result = matchCandidates(
      "laftel",
      page,
      [
        {
          title: page.title,
          url: "https://laftel.net/item/1",
          upcoming: true,
          playable: true,
        },
      ],
      true,
    );
    expect(result.status).toBe("unknown");
    expect(result.reason).toContain("공개된 에피소드");
  });
  it("distinguishes unreadable search shells from explicit no-results", () => {
    expect(
      parseSearchHtml(
        "apple",
        '<html><body><div id="app"></div></body></html>',
        "https://tv.apple.com/kr/search",
      ).complete,
    ).toBe(false);
    expect(
      parseSearchHtml(
        "apple",
        '<html><body><p class="search-page__error-message">검색 결과가 없습니다.</p></body></html>',
        "https://tv.apple.com/kr/search",
      ).complete,
    ).toBe(true);
    expect(matchCandidates("netflix", page, []).status).toBe("unknown");
  });
  it("parses service search cards without running their HTML", () => {
    const result = parseSearchHtml(
      "apple",
      '<html><body><a data-testid="search-card-lockup" aria-label="더 스누피 쇼" href="/kr/show/name/umc.cmc.123"><img alt=""><p>TV 프로그램</p></a><a href="https://evil.test/show">Bad</a></body></html>',
      "https://tv.apple.com/kr/search",
    );
    expect(result.candidates).toEqual([
      {
        title: "더 스누피 쇼",
        url: "https://tv.apple.com/kr/show/name/umc.cmc.123",
      },
    ]);
  });
});

describe("network boundaries and public search", () => {
  it("returns unknown for access blocks, timeouts and malformed responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("blocked", { status: 403 }))
      .mockRejectedValueOnce(new DOMException("timeout", "TimeoutError"))
      .mockResolvedValueOnce(new Response('{"unexpected":[]}'));
    vi.stubGlobal("fetch", fetchMock);
    expect((await searchProvider("crunchyroll", page)).status).toBe("unknown");
    expect((await searchProvider("netflix", page)).reason).toContain("초과");
    expect((await searchProvider("laftel", page)).status).toBe("unknown");
  });
  it("rejects over-limit responses before parsing", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("{}", { headers: { "content-length": "9000000" } }),
        ),
    );
    expect((await searchProvider("laftel", page)).status).toBe("unknown");
  });
  it("verifies the Laftel catalogue and handles incomplete pagination safely", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              count: 1,
              results: [
                {
                  id: 41666,
                  name: "(자막) 장송의 프리렌",
                  is_expired: false,
                  is_viewing: true,
                },
              ],
            }),
          ),
        ),
    );
    expect(await searchProvider("laftel", page)).toMatchObject({
      status: "available",
      url: "https://laftel.net/item/41666",
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            new Response(JSON.stringify({ count: 20, results: [] })),
          ),
        ),
    );
    expect((await searchProvider("laftel", page)).status).toBe("unknown");
  });
  it("preserves dub/sub ambiguity from the live Laftel API shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(fixture("laftel-search.json"))),
    );
    const result = await searchProvider("laftel", page);
    expect(result.status).toBe("ambiguous");
    expect(result.candidates).toHaveLength(2);
  });
  it("rechecks detail metadata rather than enabling an unverified search link", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          '<html><body><a data-testid="search-card-lockup" aria-label="장송의 프리렌" href="/kr/show/name/umc.cmc.123"></a></body></html>',
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          '<html><head><meta property="og:title" content="A different film"></head></html>',
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    expect((await searchProvider("apple", page)).status).toBe("unknown");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
