import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { isPlaying } from "../src/content/playback";

const primeUrl = "https://www.primevideo.com/detail/0L9GBGL4H77KZZSPBGVW5PEIGB";
function scene(body = "<video autoplay muted playsinline></video>") {
  const document = parseHTML(`<html><body>${body}</body></html>`)
    .document as unknown as Document;
  const video = document.querySelector<HTMLVideoElement>("video");
  if (video) {
    Object.defineProperties(video, {
      paused: { value: false, configurable: true },
      ended: { value: false, configurable: true },
      readyState: { value: 4, configurable: true },
      muted: { value: true, configurable: true },
      controls: { value: video.hasAttribute("controls"), configurable: true },
    });
    video.getBoundingClientRect = () => ({
      width: 1280,
      height: 720,
      top: 0,
      left: 0,
      right: 1280,
      bottom: 720,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
  }
  return { document, video: video! };
}

describe("main playback versus automatic title previews", () => {
  it.each([true, false])(
    "keeps Prime detail sidebar for a large auto preview (muted=%s)",
    (muted) => {
      const { document, video } = scene(
        '<section data-testid="hero"><video autoplay playsinline></video></section>',
      );
      Object.defineProperty(video, "muted", { value: muted });
      expect(isPlaying(document, primeUrl)).toBe(false);
    },
  );
  it("keeps the sidebar when the same Prime page swaps its poster for a trailer", () => {
    const { document } = scene(
      '<section data-testid="hero"><img src="https://example.test/poster.jpg"></section>',
    );
    expect(isPlaying(document, primeUrl)).toBe(false);
    const preview = scene().video;
    document.querySelector("section")!.replaceChildren(preview);
    expect(isPlaying(document, primeUrl)).toBe(false);
    preview.setAttribute("poster", "https://example.test/another-poster.jpg");
    preview.setAttribute("src", "blob:https://www.primevideo.com/preview");
    expect(isPlaying(document, primeUrl)).toBe(false);
  });
  it("ignores the observed Laftel modal's automatic looping DynamicItemVideo preview", () => {
    const { document } = scene(
      '<div id="item-modal"><div class="DynamicItemVideo__Block"><video class="DynamicItemVideo__Video" autoplay loop playsinline poster="https://thumbnail.laftel.net/poster.jpg" src="blob:https://laftel.net/preview"></video></div></div>',
    );
    expect(
      isPlaying(
        document,
        "https://laftel.net/search?keyword=프리렌&modal=41666",
      ),
    ).toBe(false);
  });
  it("ignores Netflix preview-modal video and generic SDK containers without playback controls", () => {
    const netflix = scene(
      '<div class="previewModal--player-container"><video autoplay></video></div>',
    );
    expect(
      isPlaying(netflix.document, "https://www.netflix.com/browse?jbv=123"),
    ).toBe(false);
    const prime = scene(
      '<div class="webPlayerSDKContainer"><video autoplay></video><button aria-label="Mute">Mute</button></div>',
    );
    expect(isPlaying(prime.document, primeUrl)).toBe(false);
  });
  it("hides for native-control playback, then returns on pause or end", () => {
    const { document, video } = scene("<video controls></video>");
    expect(isPlaying(document, primeUrl)).toBe(true);
    Object.defineProperty(video, "paused", { value: true, configurable: true });
    expect(isPlaying(document, primeUrl)).toBe(false);
    Object.defineProperties(video, {
      paused: { value: false },
      ended: { value: true },
    });
    expect(isPlaying(document, primeUrl)).toBe(false);
  });
  it.each([
    "https://www.wavve.com/player/vod?contentid=M_EP20230101.1",
    "https://www.wavve.com/player/movie.html?movieid=MV123",
    "https://laftel.net/player/41666/65123",
    "https://www.netflix.com/watch/81726714",
  ])("hides real playback with custom controls on %s", (url) => {
    expect(isPlaying(scene().document, url)).toBe(true);
  });
  it("does not trust a player-looking URL on an unrelated hostname", () => {
    expect(
      isPlaying(scene().document, "https://evil.test/player/vod?contentid=123"),
    ).toBe(false);
  });
  it("recognizes full-player transport controls but does not confuse the hero preview SDK", () => {
    const main = scene(
      '<div id="dv-web-player"><video></video><div role="slider" aria-label="Seek"></div></div>',
    );
    expect(isPlaying(main.document, primeUrl)).toBe(true);
    const preview = scene(
      '<section data-testid="hero-preview"><div id="dv-web-player"><video autoplay></video><div role="slider" aria-label="Seek"></div></div></section>',
    );
    expect(isPlaying(preview.document, primeUrl)).toBe(false);
    const dialog = scene(
      '<section role="dialog" aria-label="Video player"><video></video></section>',
    );
    expect(isPlaying(dialog.document, primeUrl)).toBe(true);
  });
  it.each(["fullscreenElement", "pictureInPictureElement"])(
    "hides for intentional %s playback",
    (property) => {
      const { document, video } = scene();
      Object.defineProperty(document, property, { value: video });
      expect(isPlaying(document, primeUrl)).toBe(true);
    },
  );
  it("ignores hidden, small or unready video elements", () => {
    const hidden = scene("<div hidden><video controls></video></div>");
    expect(isPlaying(hidden.document, primeUrl)).toBe(false);
    const cssHidden = scene(
      '<div style="display:none"><video controls></video></div>',
    );
    expect(isPlaying(cssHidden.document, primeUrl)).toBe(false);
    const small = scene("<video controls></video>");
    small.video.getBoundingClientRect = () =>
      ({ width: 100, height: 60 }) as DOMRect;
    expect(isPlaying(small.document, primeUrl)).toBe(false);
    const unready = scene("<video controls></video>");
    Object.defineProperty(unready.video, "readyState", { value: 1 });
    expect(isPlaying(unready.document, primeUrl)).toBe(false);
  });
});
