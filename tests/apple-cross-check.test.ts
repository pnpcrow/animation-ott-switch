import { afterEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { readSearchResults } from "../src/providers/search-results";
import { extractPage } from "../src/providers/extract";
import { searchProvider } from "../src/providers/search";

const title = "어느 마녀가 죽을 때까지";
const searchUrl = `https://tv.apple.com/kr/search?term=${encodeURIComponent(title)}`;
const detailUrl =
  "https://tv.apple.com/kr/show/witch/umc.cmc.73fz5uhuj4bg23v2gz5eqblix";
// Reduced from the public KR search response on 2026-11-13: the exact title
// search returned this state while the title's KR catalog detail returned 200.
const emptySearch = `<html><head><title>Apple TV</title></head><body><main>
  <div class="search-page__error-message-container">
    <div role="status" class="page-error"><h1 data-testid="page-error-title">결과 없음</h1></div>
    <p class="search-page__error-message">Apple TV에 ‘${title}’에 대한 검색 결과가 없습니다. 다른 검색어로 검색하십시오.</p>
  </div>
</main></body></html>`;
const documentFor = (html: string) =>
  parseHTML(html).document as unknown as Document;

afterEach(() => vi.unstubAllGlobals());

describe("Apple TV public search coverage", () => {
  it("does not treat the real Apple empty-search state as catalog absence", () => {
    expect(
      readSearchResults(documentFor(emptySearch), "apple", searchUrl),
    ).toMatchObject({
      candidates: [],
      complete: false,
      reason: expect.stringContaining("전체 작품 카탈로그"),
    });
    expect(
      extractPage(
        documentFor(`<html><head><title>${title} - Apple TV</title>
          <meta property="og:title" content="${title} - Apple TV">
          <meta property="og:url" content="${detailUrl}"></head>
          <body><h1>${title}</h1></body></html>`),
        detailUrl,
      ),
    ).toMatchObject({ title, provider: "apple", url: detailUrl });
  });

  it("keeps public automatic lookup unknown after Apple's explicit empty response", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(emptySearch));
    vi.stubGlobal("fetch", fetcher);
    const result = await searchProvider("apple", {
      provider: "laftel",
      url: "https://laftel.net/item/42783",
      title,
      description: "",
      imageUrl: "",
      aliases: [],
    });
    expect(result.status).toBe("unknown");
    expect(result.url).toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith(searchUrl, expect.any(Object));
  });

  it("does not promote unrelated Apple search cards to an exact match", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(`<html><head><title>Apple TV</title></head><body><main>
          <h2>인기 검색 결과</h2>
          <a href="/kr/show/wondla/umc.cmc.2ghd8ombh4fd37rfs27ivfa94">
            <span class="search-card-title">'원더라' - WondLa</span>
          </a></main></body></html>`),
      ),
    );
    const result = await searchProvider("apple", {
      provider: "laftel",
      url: "https://laftel.net/item/41666",
      title: "장송의 프리렌",
      description: "",
      imageUrl: "",
      aliases: [],
    });
    expect(result.status).toBe("unknown");
    expect(result.url).toBeUndefined();
  });
});
