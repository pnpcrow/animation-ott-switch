import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { extractPage } from "../src/providers/extract";

const title = "어느 마녀가 죽을 때까지";
const url = "https://www.tving.com/contents/P001791654";
// Minimal public DOM structure observed on 2026-11-13; synopsis is synthetic.
const fixture = ({
  name = title,
  episodeTitle = `${name} 1화`,
  pageUrl = url,
  type = "TVSeries",
  date = "2025-04-01",
}: {
  name?: string;
  episodeTitle?: string;
  pageUrl?: string;
  type?: string;
  date?: string;
} = {}) => `
<html><head><title>${episodeTitle} | TVING</title><link rel="canonical" href="${pageUrl}">
<meta property="og:url" content="${pageUrl}"><meta property="og:title" content="${episodeTitle} | TVING">
<meta property="og:image" content="https://image.tving.com/${pageUrl.split("/").at(-1)}.jpg">
<script type="application/ld+json">${JSON.stringify({ "@type": type, url: pageUrl, name: episodeTitle, description: "마녀의 여행과 만남.", datePublished: date })}</script></head>
<body><main><section><h1 class="sr-only">${episodeTitle}</h1><article><h1><picture><img alt="${name}" src="https://image.tving.com/logo.png"></picture></h1>
<div class="tag_wrap tag_detail"><div class="tag tag-blank">2025</div><div class="tag">애니메이션</div></div>
<button data-testid="content-detail-cta-button">이용권 구독하고 시청하기</button></article></section>
<section><h2>비슷한 콘텐츠</h2><img alt="다른 작품" src="https://image.tving.com/recommended.jpg"></section></main></body></html>`;
const doc = (html = fixture()) =>
  parseHTML(html).document as unknown as Document;

describe("Tving program detail extraction", () => {
  it("uses the visible series logo instead of episode-decorated schema and screen-reader headings", () => {
    expect(extractPage(doc(), url)).toEqual({
      provider: "tving",
      url,
      title,
      aliases: [],
      description: "마녀의 여행과 만남.",
      imageUrl: "https://image.tving.com/P001791654.jpg",
      year: 2025,
    });
  });
  it("preserves season and director-cut distinctions while removing a corroborated episode wrapper", () => {
    for (const name of [
      "장송의 프리렌 2기 (자막)",
      "Re:제로부터 시작하는 이세계 생활 감독판",
    ]) {
      expect(extractPage(doc(fixture({ name })), url)?.title).toBe(
        name.replace(" (자막)", ""),
      );
    }
  });
  it("preserves an actual title ending with an episode-like word when the logo itself has it", () => {
    expect(
      extractPage(
        doc(
          fixture({
            name: "우리들의 제1화",
            episodeTitle: "우리들의 제1화 1화",
          }),
        ),
        url,
      )?.title,
    ).toBe("우리들의 제1화");
  });
  it("rejects disagreement between visible logo and structured or page metadata", () => {
    expect(
      extractPage(doc(fixture({ episodeTitle: "다른 마녀의 여행 1화" })), url),
    ).toBeNull();
  });
  it("rejects stale program IDs", () => {
    expect(
      extractPage(
        doc(fixture({ pageUrl: "https://www.tving.com/contents/P001747384" })),
        url,
      ),
    ).toBeNull();
  });
  it("does not strip movie names using a program-only episode rule", () => {
    const movieUrl = "https://www.tving.com/contents/M000359644";
    expect(
      extractPage(
        doc(
          fixture({
            name: "제폭 : 범죄와의 전쟁",
            episodeTitle: "제폭 : 범죄와의 전쟁",
            type: "Movie",
            pageUrl: movieUrl,
          }),
        ),
        movieUrl,
      )?.title,
    ).toBe("제폭 : 범죄와의 전쟁");
    expect(
      extractPage(
        doc(
          fixture({
            name: "제폭 : 범죄와의 전쟁",
            episodeTitle: "제폭 : 범죄와의 전쟁 1화",
            type: "Movie",
            pageUrl: movieUrl,
          }),
        ),
        movieUrl,
      ),
    ).toBeNull();
  });
  it("uses the visible release year when schema omits it", () => {
    expect(extractPage(doc(fixture({ date: "" })), url)?.year).toBe(2025);
  });
  it("does not pick one of conflicting visible detail logos", () => {
    const document = doc();
    const hero = document.querySelector("section")!.cloneNode(true) as Element;
    hero.querySelector("img")!.setAttribute("alt", "다른 작품");
    document.querySelector("main")!.appendChild(hero);
    expect(extractPage(document, url)).toBeNull();
  });
});
