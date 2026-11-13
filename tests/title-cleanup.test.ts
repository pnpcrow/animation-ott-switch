import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import {
  cleanPageTitle,
  cleanSearchTitle,
  cleanTitle,
  normalizeTitle,
  providers,
} from "../src/providers/identity";
import { extractPage } from "../src/providers/extract";

const documentFor = (html: string) =>
  parseHTML(html).document as unknown as Document;
const netflix = "https://www.netflix.com/title/12345678";

describe("service title decoration", () => {
  it.each([
    [
      "  Watch Frieren: Beyond Journey's End – Prime Video  ",
      "Frieren: Beyond Journey's End",
    ],
    ["Watch 장송의 프리렌 — Netflix Official Site", "장송의 프리렌"],
    [
      "Watch Once Upon a Witch's Death - Crunchyroll",
      "Once Upon a Witch's Death",
    ],
    ["Watch The Watch | Netflix Official Site", "The Watch"],
    ["Watch Watch Dogs | Netflix Official Site", "Watch Dogs"],
    ["Watch Naruto on Crunchyroll", "Naruto"],
    ["장송의 프리렌 보기 | 넷플릭스 공식 사이트", "장송의 프리렌"],
    ["장송의 프리렌 시청하기 | Netflix", "장송의 프리렌"],
    ["Frieren - Watch | Crunchyroll", "Frieren"],
    ["Prime Video: Night Watch", "Night Watch"],
  ])("cleans known page wrapper %s", (raw, title) => {
    expect(cleanTitle(raw)).toBe(title);
    expect(cleanTitle(cleanTitle(raw))).toBe(title);
  });

  it.each([
    "Watch Dogs",
    "The Watch",
    "Night Watch",
    "Watch Me",
    "Watch Watch",
    "Watchmen",
    "End of Watch",
  ])("preserves genuine title words in %s", (title) => {
    expect(cleanTitle(title)).toBe(title);
    expect(cleanSearchTitle(title)).toBe(title);
    expect(cleanPageTitle(title, "netflix", "title")).toBe(title);
  });

  it("uses explicit title evidence for action labels and strips only one wrapper", () => {
    expect(
      cleanPageTitle("Watch Frieren", "crunchyroll", "label", ["Frieren"]),
    ).toBe("Frieren");
    expect(
      cleanPageTitle("Watch Watch Dogs", "netflix", "label", ["Watch Dogs"]),
    ).toBe("Watch Dogs");
    expect(
      cleanPageTitle("Watch Dogs", "netflix", "metadata", ["Watch Dogs"]),
    ).toBe("Watch Dogs");
    expect(cleanSearchTitle("Watch Frieren", "crunchyroll", ["Frieren"])).toBe(
      "Frieren",
    );
    expect(normalizeTitle("Watch Dogs")).not.toBe(normalizeTitle("Dogs"));
  });

  it("never sends recognized decoration to any provider's search URL", () => {
    for (const provider of providers) {
      const url = new URL(
        provider.searchUrl("Watch 장송의 프리렌 – Prime Video"),
      );
      expect([...url.searchParams.values()]).toContain("장송의 프리렌");
      expect(url.href).not.toContain("Watch");
      expect(provider.searchUrl("Watch Dogs")).toContain("Watch%20Dogs");
    }
  });
});

describe("page title source awareness", () => {
  it("cleans a CTA heading using the page's cleaned metadata", () => {
    const document = documentFor(
      '<html><head><meta property="og:title" content="Watch Frieren"><title>Watch Frieren | Netflix Official Site</title></head><body><h1>Watch Frieren</h1></body></html>',
    );
    expect(extractPage(document, netflix)?.title).toBe("Frieren");
  });

  it("retains authoritative title words instead of cleaning them as actions", () => {
    const document = documentFor(
      '<html><head><meta property="og:title" content="Watch Watch Dogs"><script type="application/ld+json">{"@type":"Movie","name":"Watch Dogs"}</script></head><body><h1>Watch Dogs</h1></body></html>',
    );
    expect(extractPage(document, netflix)?.title).toBe("Watch Dogs");
  });

  it("drops nested player buttons from title heading text", () => {
    const document = documentFor(
      "<html><head><title>Netflix</title></head><body><h1><button>Watch</button>Frieren</h1></body></html>",
    );
    expect(extractPage(document, netflix)?.title).toBe("Frieren");
  });

  it("cleans bare metadata Watch wrappers only when the source defines them", () => {
    const document = documentFor(
      '<html><head><meta property="og:title" content="Watch Once Upon a Witch\'s Death"></head></html>',
    );
    expect(
      extractPage(document, "https://www.crunchyroll.com/series/G123")?.title,
    ).toBe("Once Upon a Witch's Death");
    expect(cleanPageTitle("Watch Dogs", "laftel", "metadata")).toBe(
      "Watch Dogs",
    );
  });

  it("keeps seasons and title punctuation after removing the watch action", () => {
    const document = documentFor(
      "<html><head><title>Watch Frieren Season 2 – Prime Video</title></head></html>",
    );
    expect(
      extractPage(
        document,
        "https://www.primevideo.com/detail/0SE34WYHAUR2RNAVB52KP1S8QH",
      )?.title,
    ).toBe("Frieren Season 2");
  });
});
