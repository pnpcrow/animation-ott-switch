import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import {
  canonicalizeProviderUrl,
  isDetailUrl,
  providerTitleId,
} from "../src/providers/identity";
import { extractPage } from "../src/providers/extract";

const documentFor = (html: string) =>
  parseHTML(html).document as unknown as Document;
const netflixModal =
  '<div class="previewModal--container"><img class="previewModal--player-titleTreatment-logo" alt="Frieren"><p class="previewModal--text">An elf starts a new journey.</p><span data-uia="title-info-year">2023</span></div>';

describe("Netflix title modal routes", () => {
  it.each([
    "https://www.netflix.com/search?q=Frieren&jbv=81726714",
    "https://www.netflix.com/browse?jbv=81726714",
    "https://www.netflix.com/browse/genre/7424?jbv=81726714",
    "https://www.netflix.com/kr/browse/my-list?jbv=81726714",
    "https://www.netflix.com/browse/originals?jbv=81726714",
    "https://www.netflix.com/title/99999?jbv=81726714",
  ])("resolves the active modal's ID from %s", (url) => {
    expect(providerTitleId(url)).toBe("81726714");
    expect(canonicalizeProviderUrl(url)).toBe(
      "https://www.netflix.com/title/81726714",
    );
    expect(
      extractPage(
        documentFor(`<html><body>${netflixModal}</body></html>`),
        url,
      ),
    ).toMatchObject({
      title: "Frieren",
      url: "https://www.netflix.com/title/81726714",
      year: 2023,
    });
  });

  it.each([
    "https://www.netflix.com/watch/81726714?jbv=81726714",
    "https://www.netflix.com/login?jbv=81726714",
    "https://www.netflix.com/account?jbv=81726714",
    "https://www.netflix.com/browse/unknown/route?jbv=81726714",
    "https://www.netflix.com/search?q=Frieren&jbv=not-a-title",
    "https://www.netflix.com/title/99999?jbv=not-a-title",
  ])("does not turn an unrelated path into a detail modal: %s", (url) => {
    expect(isDetailUrl(url)).toBe(false);
    expect(
      extractPage(
        documentFor(`<html><body>${netflixModal}</body></html>`),
        url,
      ),
    ).toBeNull();
  });

  it("requires a visible Netflix modal instead of falling back to home metadata", () => {
    const document = documentFor(
      '<html><head><meta property="og:title" content="Home recommendations"></head><body><div role="dialog"><h1>Cookie settings</h1></div><div class="previewModal--container" hidden><img class="previewModal--player-titleTreatment-logo" alt="Previous title"></div></body></html>',
    );
    expect(
      extractPage(
        document,
        "https://www.netflix.com/search?q=Frieren&jbv=81726714",
      ),
    ).toBeNull();
  });

  it("ignores stale background JSON-LD title, description and year", () => {
    const document = documentFor(
      `<html><head><link rel="canonical" href="https://www.netflix.com/browse"><meta property="og:title" content="Home"><script type="application/ld+json">{"@type":"TVSeries","name":"Previous recommendation","description":"Unrelated synopsis","datePublished":"1999-01-01"}</script></head><body>${netflixModal.replace('<span data-uia="title-info-year">2023</span>', "")}</body></html>`,
    );
    const page = extractPage(
      document,
      "https://www.netflix.com/browse/genre/7424?jbv=81726714",
    );
    expect(page).toMatchObject({
      title: "Frieren",
      description: "An elf starts a new journey.",
    });
    expect(page?.year).toBeUndefined();
  });

  it("skips hidden and mismatched previous modal instances", () => {
    const document = documentFor(
      `<html><body>${netflixModal}<div class="previewModal--container" aria-hidden="true"><img class="previewModal--player-titleTreatment-logo" alt="Hidden title"></div><div class="previewModal--container" data-video-id="99999"><img class="previewModal--player-titleTreatment-logo" alt="Old title"></div></body></html>`,
    );
    expect(
      extractPage(
        document,
        "https://www.netflix.com/search?q=Frieren&jbv=81726714",
      )?.title,
    ).toBe("Frieren");
  });
});

const laftelContent = (id = "41666") =>
  `<div id="item-modal" class="ItemModalLayout__ItemModalBlock-test"><div class="ItemHeader-test"><video class="DynamicItemVideo__Video-test" poster="https://thumbnail.laftel.net/items/home/frieren.jpg"></video></div><h1 class="ItemInfoHeader__Title-test">(자막) 장송의 프리렌</h1><span class="ItemInfoBody__SummaryText-test">천 년을 살아온 마법사의 새로운 여행.</span><span class="MoreText-test">더 보기</span><nav><a href="/search?keyword=프리렌&amp;modal=${id}&amp;route=episode">에피소드</a><a href="/search?keyword=프리렌&amp;modal=${id}&amp;route=review">리뷰</a></nav><a href="/player/${id}/65123">재생</a><img src="https://thumbnail.laftel.net/episodes/not-the-hero.jpg"></div>`;

describe("Laftel catalog detail modals", () => {
  it.each([
    "https://laftel.net/?modal=41666",
    "https://laftel.net/search?keyword=프리렌&modal=41666",
    "https://laftel.net/search?keyword=프리렌&modal=41666&route=episode",
    "https://laftel.net/item/99999?modal=41666",
  ])("extracts a scoped active modal from %s", (url) => {
    const document = documentFor(
      `<html><head><title>라프텔 홈</title><link rel="canonical" href="https://laftel.net/"><meta property="og:image" content="https://example.com/home.jpg"><script type="application/ld+json">{"@type":"TVSeries","name":"Background recommendation","description":"Wrong synopsis","datePublished":"1999-01-01"}</script></head><body><h1>검색 결과</h1>${laftelContent()}</body></html>`,
    );
    expect(providerTitleId(url)).toBe("41666");
    expect(canonicalizeProviderUrl(url)).toBe(
      "https://laftel.net/?modal=41666",
    );
    const page = extractPage(document, url);
    expect(page).toMatchObject({
      provider: "laftel",
      url: "https://laftel.net/?modal=41666",
      title: "장송의 프리렌",
      description: "천 년을 살아온 마법사의 새로운 여행.",
      imageUrl: "https://thumbnail.laftel.net/items/home/frieren.jpg",
    });
    expect(page?.year).toBeUndefined();
  });

  it("retains the existing standalone canonical URL", () => {
    expect(
      canonicalizeProviderUrl("https://laftel.net/item/41666/프리렌"),
    ).toBe("https://laftel.net/item/41666");
    expect(providerTitleId("https://laftel.net/item/41666")).toBe(
      providerTitleId("https://laftel.net/?modal=41666"),
    );
  });

  it.each([
    "https://laftel.net/search?keyword=프리렌",
    "https://laftel.net/player/41666/65123?modal=41666",
    "https://laftel.net/login?modal=41666",
    "https://laftel.net/search?modal=unknown",
  ])(
    "does not accept a search/player/account route without a supported modal identity: %s",
    (url) => {
      expect(isDetailUrl(url)).toBe(false);
      expect(
        extractPage(
          documentFor(`<html><body>${laftelContent()}</body></html>`),
          url,
        ),
      ).toBeNull();
    },
  );

  it("does not use a hidden, closed or previous-title modal", () => {
    const url = "https://laftel.net/search?keyword=프리렌&modal=41666";
    expect(
      extractPage(
        documentFor(`<html><body>${laftelContent("42389")}</body></html>`),
        url,
      ),
    ).toBeNull();
    expect(
      extractPage(
        documentFor(
          `<html><body>${laftelContent().replace('id="item-modal"', 'id="item-modal" style="display:none"')}</body></html>`,
        ),
        url,
      ),
    ).toBeNull();
    expect(
      extractPage(
        documentFor(
          '<html><head><meta property="og:title" content="Background recommendation"></head><body><h1>Background recommendation</h1></body></html>',
        ),
        url,
      ),
    ).toBeNull();
  });

  it("requires matching identity evidence instead of trusting any modal heading", () => {
    const document = documentFor(
      '<html><body><div id="item-modal"><h1 class="ItemInfoHeader__Title-test">Wrong title</h1></div></body></html>',
    );
    expect(extractPage(document, "https://laftel.net/?modal=41666")).toBeNull();
  });

  it("can use the modal's own player link when navigation tabs have not rendered", () => {
    const document = documentFor(
      '<html><body><div id="item-modal"><h1 class="ItemInfoHeader__Title-test">장송의 프리렌</h1><span class="ItemInfoBody__SummaryText-test">소개</span><div class="ItemHeader-test"><img src="https://thumbnail.laftel.net/hero.jpg"></div><a href="/player/41666/65123">재생</a></div></body></html>',
    );
    expect(
      extractPage(document, "https://laftel.net/?modal=41666"),
    ).toMatchObject({
      title: "장송의 프리렌",
      imageUrl: "https://thumbnail.laftel.net/hero.jpg",
    });
  });
});
