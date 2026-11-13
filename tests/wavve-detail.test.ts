import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { extractPage } from "../src/providers/extract";
import {
  canonicalizeProviderUrl,
  cleanTitle,
  providerTitleId,
} from "../src/providers/identity";

const url =
  "https://www.wavve.com/player/vod?programid=CF02_CF0000000119&landing=season";
const title = "어느 마녀가 죽을 때까지";
const poster =
  "https://image.wavve.com/v1/thumbnails/1240_698/meta/image/202509/1757326229391943332.jpg";
const synopsis =
  "견습 마녀 메구는 여명 1년이라는 말을 듣고 기쁨의 눈물을 모으기 위한 여행을 시작한다.";
const doc = (html: string) => parseHTML(html).document as unknown as Document;

// Minimized from Wavve's public rendered program page, observed 2026-11-13.
// Preserve duplicate metadata and DOM structure; descriptions are shortened.
const staticHead = `<title>${title} : 웨이브</title>
  <meta property="og:title" content="Wavve(웨이브)">
  <meta property="og:description" content="세상 얕은 콘텐츠부터 세상 딥한 콘텐츠까지 JUST DIVE! Wavve">
  <meta property="og:image" content="http://img.wavve.com/service30/profile/wavve2022.png">
  <meta property="og:url" content="https://www.wavve.com">`;
const dynamicHead = (id = "CF02_CF0000000119", name = title) => `
  <meta data-vue-meta="ssr" property="og:title" content="[wavve]${name}" data-vmid="og:title">
  <meta data-vue-meta="ssr" property="og:description" content="1회 여명 1년의 마녀" data-vmid="og:description">
  <meta data-vue-meta="ssr" property="og:image" content="http://" data-vmid="og:image">
  <meta data-vue-meta="ssr" property="og:url" content="www.wavve.com/player/vod?programid=${id}&amp;landing=season" data-vmid="og:url">`;
const hero = `<div class="video-wrap">
  <div class="player-area full"><div class="poster-box"><picture><img class="w-img poster-thumb" src="${poster}" alt="${title}"></picture></div></div>
  <div class="video-detail-area"><h1 class="logo-box"><em class="logo"><picture><img alt="${title}" src="https://image.wavve.com/logo.png"></picture></em></h1>
    <div class="detail-info-box player-detail"><p class="content-preview-box"></p>
      <div class="content-clamp"><span class="text" aria-label="${synopsis}">견습 마녀 메구는...</span><a href="javascript:void(0)">더보기</a></div>
    </div>
  </div>
</div>
<div class="player-list"><article class="episode-item-container"><img src="https://image.wavve.com/episode.jpg" alt="첫 회차"><p class="episode-synopsis">에피소드 전용 설명</p></article></div>
<footer><h1>공지사항</h1><img src="https://image.wavve.com/footer.png" alt="웨이브"></footer>`;

describe("Wavve program detail routes", () => {
  it("keeps the verified season landing route while removing tracking", () => {
    expect(providerTitleId(url)).toBe("CF02_CF0000000119");
    expect(canonicalizeProviderUrl(url + "&tracking=ignored")).toBe(url);
    expect(
      canonicalizeProviderUrl(url.replace("landing=season", "landing=unknown")),
    ).toBe("https://www.wavve.com/player/vod?programid=CF02_CF0000000119");
    expect(
      canonicalizeProviderUrl(
        "https://www.wavve.com/player/vod?contentid=EP123&landing=season",
      ),
    ).toBe("https://www.wavve.com/player/vod?contentid=EP123");
  });

  it("cleans Wavve branding without deleting ordinary title punctuation", () => {
    expect(cleanTitle(`[wavve]${title}`)).toBe(title);
    expect(cleanTitle(`${title} : 웨이브`)).toBe(title);
    expect(cleanTitle("영화: 다른 이야기")).toBe("영화: 다른 이야기");
    expect(cleanTitle("[Anime] Another Story")).toBe("[Anime] Another Story");
  });

  it("reads the program logo, hero image and complete synopsis instead of shell or episode data", () => {
    expect(
      extractPage(
        doc(
          `<html><head>${staticHead}${dynamicHead()}</head><body>${hero}</body></html>`,
        ),
        url,
      ),
    ).toMatchObject({
      provider: "wavve",
      url,
      title,
      imageUrl: poster,
      description: synopsis,
    });
  });

  it("prefers current Vue metadata when the original generic tags remain", () => {
    expect(
      extractPage(
        doc(
          `<html><head>${staticHead}${dynamicHead()}</head><body></body></html>`,
        ),
        url,
      ),
    ).toMatchObject({
      title,
      url,
      description: "1회 여명 1년의 마녀",
      imageUrl: "",
    });
  });

  it("does not extract a footer heading from an empty Wavve app shell", () => {
    expect(
      extractPage(
        doc(
          '<html><head><title>Wavve(웨이브)</title><meta property="og:title" content="Wavve(웨이브)"></head><body><footer><h1>공지사항</h1></footer></body></html>',
        ),
        url,
      ),
    ).toBeNull();
  });

  it.each([
    "www.wavve.com/player/vod?programid=OTHER_WORK&landing=season",
    "https://www.wavve.com/player/vod?programid=OTHER_WORK&landing=season",
  ])(
    "rejects stale current metadata identifying another work: %s",
    (declared) => {
      const head = dynamicHead().replace(
        "www.wavve.com/player/vod?programid=CF02_CF0000000119&amp;landing=season",
        declared.replaceAll("&", "&amp;"),
      );
      expect(
        extractPage(
          doc(
            `<html><head>${staticHead}${head}</head><body>${hero}</body></html>`,
          ),
          url,
        ),
      ).toBeNull();
    },
  );

  it("waits when the logo and current metadata still name different works", () => {
    expect(
      extractPage(
        doc(
          `<html><head>${staticHead}${dynamicHead("CF02_CF0000000119", "다른 작품")}</head><body>${hero}</body></html>`,
        ),
        url,
      ),
    ).toBeNull();
  });
});
