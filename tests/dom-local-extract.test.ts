import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { extractPage } from "../src/providers/extract";

const url = "https://www.primevideo.com/-/ko/detail/0L9GBGL4H77KZZSPBGVW5PEIGB";
const document = (body: string, head = "") =>
  parseHTML(`<html><head>${head}</head><body>${body}</body></html>`)
    .document as unknown as Document;
const hero = `<main><section class="work-hero"><div class="work-title">수수께끼 풀이는 저녁식사 후에</div><img class="poster" src="https://example.com/poster.jpg"><div class="plot">재벌가의 아가씨이자 형사인 주인공이 집사와 함께 어려운 사건을 해결하는 이야기입니다.</div></section></main>`;

describe("local evidence extraction fallback", () => {
  it("fills missing fields from a corroborated content island", () => {
    const result = extractPage(document(hero), url);
    expect(result).toMatchObject({
      title: "수수께끼 풀이는 저녁식사 후에",
      imageUrl: "https://example.com/poster.jpg",
    });
    expect(result?.description).toContain("집사와 함께");
  });

  it("reads a title image inside a heading and an explicitly named synopsis expander", () => {
    const synopsis =
      "어느 날 집사는 아가씨와 함께 기묘한 사건의 진실을 찾아 나서며 뜻밖의 단서를 발견합니다.";
    const body = `<main><h1><div><div><picture><img alt="수수께끼 풀이는 저녁식사 후에" src="/title.jpg"></picture></div></div></h1><button class="ItemInfoBody__SummaryButton"><span>${synopsis}</span></button></main>`;
    expect(extractPage(document(body), url)).toMatchObject({
      title: "수수께끼 풀이는 저녁식사 후에",
      description: synopsis,
    });
  });

  it("does not use a truncated image alt as a work title", () => {
    expect(
      extractPage(
        document(
          `<main><h1><img alt="${"긴 작품 제목".repeat(50)}" src="/title.jpg"></h1></main>`,
        ),
        url,
      ),
    ).toBeNull();
  });

  it("does not replace existing authoritative metadata", () => {
    const result = extractPage(
      document(
        hero,
        '<script type="application/ld+json">{"@type":"TVSeries","name":"장송의 프리렌","description":"공식 설명","image":"https://example.com/official.jpg"}</script>',
      ),
      url,
    );
    expect(result).toMatchObject({
      title: "장송의 프리렌",
      description: "공식 설명",
      imageUrl: "https://example.com/official.jpg",
    });
  });

  it("does not treat search pages as details or bypass mismatched canonical identity", () => {
    expect(
      extractPage(
        document(hero),
        "https://www.primevideo.com/search/ref=atv_nb_sug?phrase=witch",
      ),
    ).toBeNull();
    expect(
      extractPage(
        document(
          hero,
          '<link rel="canonical" href="https://www.netflix.com/title/81726714">',
        ),
        url,
      ),
    ).toBeNull();
  });

  it("abstains when multiple content islands propose different titles", () => {
    const body = hero.replace(
      "</main>",
      '<section class="work-hero"><div class="work-title">장송의 프리렌</div></section></main>',
    );
    expect(extractPage(document(body), url)).toBeNull();
  });

  it("does not borrow description or image from the background of an active modal", () => {
    const body =
      hero + '<div role="dialog" aria-modal="true"><p>구독 안내</p></div>';
    const result = extractPage(
      document(body, '<meta property="og:title" content="장송의 프리렌">'),
      url,
    );
    expect(result).toMatchObject({
      title: "장송의 프리렌",
      description: "",
      imageUrl: "",
    });
  });
});
