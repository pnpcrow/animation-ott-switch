import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { extractPage } from "../src/providers/extract";

const url = "https://www.aniplustv.com/items/3011";
// Minimal structural fixture from the public page observed 2026-11-13. The
// description is synthetic; the title/URL and DOM structure are real evidence.
const fixture = (title = "장송의 프리렌", metadata = title) => `
<html><head><title>${title} - 애니플러스</title>
<meta property="og:title" content="한일 동시 방영 애니메이션 채널 - 애니플러스">
<meta property="og:url" content="https://www.aniplustv.com">
<meta property="og:image" content="https://www.aniplustv.com/generic.png">
<meta property="og:description" content="광고 설명">
<meta data-rh="true" property="og:url" content="${url}">
<meta data-rh="true" property="og:title" content="${metadata} 애니플러스"></head>
<body><div style="display:none"><h1>""에 대한 검색 결과 ()</h1></div>
<div class="detail_layer_pop"><div class="detail_view"><div class="baner live_detail">
<div class="float_left"><div><img src="https://cdn.example.org/frieren.jpg"></div></div>
<div class="float_right"><h1>${title}<span>葬送のフリーレン</span></h1>
<div class="summary_text"><h2>줄거리</h2>마법사의 여행.<br>동료와의 만남.</div></div>
</div><h1>에피소드<span>총28화</span></h1></div></div><footer><h1>공지사항</h1></footer></body></html>`;
const doc = (html = fixture()) =>
  parseHTML(html).document as unknown as Document;

describe("Aniplus detail layer extraction", () => {
  it("reads the current hero and keeps its Japanese alias separate from the title", () => {
    expect(extractPage(doc(), url)).toEqual({
      provider: "aniplus",
      url,
      title: "장송의 프리렌",
      aliases: ["葬送のフリーレン"],
      description: "마법사의 여행.\n동료와의 만남.",
      imageUrl: "https://cdn.example.org/frieren.jpg",
    });
  });
  it("does not extract background search headings or marketing when no detail hero is present", () => {
    const document = doc();
    document.querySelector(".detail_layer_pop")!.remove();
    expect(extractPage(document, url)).toBeNull();
  });
  it("rejects hidden detail layers", () => {
    const document = doc();
    document
      .querySelector(".detail_layer_pop")!
      .setAttribute("style", "display:none");
    expect(extractPage(document, url)).toBeNull();
  });
  it("rejects a stale hydrated detail ID despite the generic home og:url preceding it", () => {
    const document = doc();
    document
      .querySelector('meta[data-rh][property="og:url"]')!
      .setAttribute("content", "https://www.aniplustv.com/items/3782");
    expect(extractPage(document, url)).toBeNull();
  });
  it("rejects a title transition while hydrated metadata and the visible hero disagree", () => {
    expect(
      extractPage(doc(fixture("장송의 프리렌", "장송의 프리렌 2기")), url),
    ).toBeNull();
  });
  it("preserves the season while applying shared title decoration normalization", () => {
    expect(
      extractPage(doc(fixture("장송의 프리렌 2기 (한국어 더빙)")), url)?.title,
    ).toBe("장송의 프리렌 2기");
  });
  it("does not show a detail overlay on a search route", () => {
    expect(
      extractPage(doc(), "https://www.aniplustv.com/Search?st=프리렌"),
    ).toBeNull();
  });
  it("refuses ambiguous duplicate visible detail heroes", () => {
    const document = doc();
    document.body.appendChild(
      document.querySelector(".detail_layer_pop")!.cloneNode(true),
    );
    expect(extractPage(document, url)).toBeNull();
  });
});
