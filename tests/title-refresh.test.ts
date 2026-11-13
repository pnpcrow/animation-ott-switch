import { afterEach, describe, expect, it, vi } from "vitest";
import { readDetailPage } from "../src/providers/search";

const netflix = "https://www.netflix.com/title/12345678";
const html =
  '<html><head><title>Watch Frieren – Netflix Official Site</title><meta property="og:title" content="Watch Frieren"><meta property="og:description" content="A long journey."></head><body><h1>Frieren</h1></body></html>';
afterEach(() => vi.unstubAllGlobals());

describe("official detail title refresh", () => {
  it("reads the original source page and returns a cleaned title", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(html));
    vi.stubGlobal("fetch", fetchMock);
    expect(await readDetailPage("netflix", netflix)).toMatchObject({
      provider: "netflix",
      url: netflix,
      title: "Frieren",
      description: "A long journey.",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      netflix,
      expect.objectContaining({
        credentials: "omit",
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it.each([
    "https://www.netflix.com/search?q=Frieren",
    "https://www.netflix.com.evil.test/title/12345678",
    "https://www.netflix.com/watch/12345678",
    "https://laftel.net/item/12345678",
    "javascript:alert(1)",
  ])("refuses to request an unsafe or non-detail URL: %s", async (url) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await readDetailPage("netflix", url)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null for blocks, timeouts, an oversized page, and malformed metadata", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("blocked", { status: 403 }))
      .mockRejectedValueOnce(new DOMException("timeout", "TimeoutError"))
      .mockResolvedValueOnce(
        new Response(html, { headers: { "content-length": "9000000" } }),
      )
      .mockResolvedValueOnce(
        new Response("<html><head><title>Netflix</title></head></html>"),
      );
    vi.stubGlobal("fetch", fetchMock);
    for (let i = 0; i < 4; i++)
      expect(await readDetailPage("netflix", netflix)).toBeNull();
  });

  it("rejects redirects to another work instead of changing the source identity", async () => {
    const response = new Response(html);
    Object.defineProperty(response, "url", {
      value: "https://www.netflix.com/title/99999999",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    expect(await readDetailPage("netflix", netflix)).toBeNull();
  });

  it("accepts a localized redirect that keeps the same official work ID", async () => {
    const response = new Response(html);
    Object.defineProperty(response, "url", {
      value: "https://www.netflix.com/kr/title/12345678",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    expect((await readDetailPage("netflix", netflix))?.title).toBe("Frieren");
  });

  it("rejects stale canonical metadata after a SPA-style source transition", async () => {
    const response = new Response(
      '<html><head><title>Watch Frieren | Netflix</title><meta property="og:url" content="https://www.netflix.com/title/99999999"></head></html>',
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    expect(await readDetailPage("netflix", netflix)).toBeNull();
  });

  it.each([
    "<title>Crunchyroll: Watch Popular Anime, Play Games &amp; Shop Online</title>",
    "<h1>Crunchyroll: Watch Popular Anime, Play Games &amp; Shop Online</h1>",
    '<script type="application/ld+json">{"@type":"TVSeries","name":"Crunchyroll: Watch Popular Anime, Play Games & Shop Online"}</script>',
    '<meta property="og:title" content="Watch Popular Anime, Play Games &amp; Shop Online">',
  ])(
    "rejects the Crunchyroll landing shell at the expected series URL: %s",
    async (markup) => {
      const url = "https://www.crunchyroll.com/series/G123";
      const response = new Response(
        `<html><head></head><body>${markup}</body></html>`,
      );
      Object.defineProperty(response, "url", { value: url });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      expect(await readDetailPage("crunchyroll", url)).toBeNull();
    },
  );

  it("rejects service-branded landing text instead of treating it as a work", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            "<html><head><title>Netflix: Watch TV Shows Online, Watch Movies Online</title></head></html>",
          ),
        ),
    );
    expect(await readDetailPage("netflix", netflix)).toBeNull();
  });

  it("uses the real work heading when Crunchyroll keeps generic page metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            "<html><head><title>Crunchyroll: Watch Popular Anime, Play Games &amp; Shop Online</title></head><body><h1>어느 마녀가 죽을 때까지</h1></body></html>",
          ),
        ),
    );
    expect(
      (
        await readDetailPage(
          "crunchyroll",
          "https://www.crunchyroll.com/series/G123",
        )
      )?.title,
    ).toBe("어느 마녀가 죽을 때까지");
  });

  it("keeps a genuine Watch title when refreshing source metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            '<html><head><meta property="og:title" content="Watch Watch Dogs | Crunchyroll"><script type="application/ld+json">{"@type":"TVSeries","name":"Watch Dogs"}</script></head><body><h1>Watch Dogs</h1></body></html>',
          ),
        ),
    );
    expect(
      (
        await readDetailPage(
          "crunchyroll",
          "https://www.crunchyroll.com/series/G123",
        )
      )?.title,
    ).toBe("Watch Dogs");
  });
});
