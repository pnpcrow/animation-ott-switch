import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { extractPage } from "../src/providers/extract";
import { safeImageUrl } from "../src/providers/identity";

describe("incomplete public catalog metadata", () => {
  it("does not turn a missing image into the HTML detail URL", () => {
    const url =
      "https://tv.apple.com/kr/show/name/umc.cmc.2yfxu8u0trajtjk7o3hsdyn2d";
    const { document } = parseHTML("<h1>카드캡터 체리</h1>");
    expect(extractPage(document, url)?.imageUrl).toBe("");
    expect(safeImageUrl("  ", url)).toBe("");
    expect(safeImageUrl("/poster.jpg", url)).toBe(
      "https://tv.apple.com/poster.jpg",
    );
  });
  it("ignores an unpublished synopsis template and uses visible text when supplied", () => {
    const url = "https://laftel.net/item/41714";
    const shell =
      '<meta property="og:title" content="약사의 혼잣말"><meta property="og:description" content="{줄거리}">';
    expect(extractPage(parseHTML(shell).document, url)?.description).toBe("");
    expect(
      extractPage(
        parseHTML(shell + '<p class="synopsis">화면에 공개된 소개</p>')
          .document,
        url,
      )?.description,
    ).toBe("화면에 공개된 소개");
  });
});
