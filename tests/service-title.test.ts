import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import {
  cleanSearchPage,
  cleanTitle,
  providers,
} from "../src/providers/identity";
import { extractPage } from "../src/providers/extract";

const title = "수수께끼 풀이는 저녁식사 후에";
const prime = "https://www.primevideo.com/detail/B012345678";

describe("shared service decoration across all outgoing searches", () => {
  it.each([
    "라프텔",
    "Laftel",
    "애니플러스",
    "ANIPLUS",
    "크런치롤",
    "Crunchyroll",
    "넷플릭스",
    "Netflix",
    "프라임 비디오",
    "프라임비디오",
    "Prime Video",
    "애플 TV",
    "Apple TV+",
    "웨이브",
    "Wavve(웨이브)",
    "티빙",
    "TVING",
    "쿠팡플레이",
    "Coupang Play",
    "왓챠",
    "WATCHA",
  ])("strips the %s prefix before any provider receives a keyword", (brand) => {
    const decorated = `${brand}: ${title}`;
    expect(cleanTitle(decorated)).toBe(title);
    expect(cleanTitle(`${brand}： ${title}`)).toBe(title);
    expect(cleanTitle(`${title} | ${brand}`)).toBe(title);
    for (const provider of providers) {
      expect([
        ...new URL(provider.searchUrl(decorated)).searchParams.values(),
      ]).toContain(title);
    }
  });

  it("cleans Korean Prime JSON-LD, page metadata and old saved aliases consistently", () => {
    const decorated = `프라임 비디오: ${title}`;
    const document = parseHTML(`<html><head><title>${decorated}</title>
      <meta property="og:title" content="${decorated}">
      <script type="application/ld+json">${JSON.stringify({ "@type": "TVSeries", name: decorated })}</script>
      </head><body><h1>${title}</h1></body></html>`)
      .document as unknown as Document;
    expect(extractPage(document, prime)?.title).toBe(title);
    const page = {
      provider: "prime" as const,
      url: prime,
      title: decorated,
      aliases: [decorated, title],
      imageUrl: "",
      description: "",
    };
    expect(cleanSearchPage(page)).toMatchObject({ title, aliases: [] });
    expect(page.title).toBe(decorated);
  });

  it.each([
    "Re:ZERO Season 2",
    "영화: 다른 이야기",
    "Watch Dogs",
    "The Watch",
    "Prime Suspect",
    "Apple Tree",
  ])("keeps punctuation and title words in %s", (name) =>
    expect(cleanTitle(name)).toBe(name),
  );

  it.each([
    "Crunchyroll: Watch Popular Anime, Play Games & Shop Online",
    "Netflix: Watch TV Shows Online, Watch Movies Online",
  ])(
    "still rejects generic landing metadata after removing branding: %s",
    (name) => {
      const document = parseHTML(
        `<html><head><meta property="og:title" content="${name}"></head></html>`,
      ).document as unknown as Document;
      expect(extractPage(document, prime)).toBeNull();
    },
  );
});
