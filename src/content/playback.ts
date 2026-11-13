import { detectProvider } from "../providers/identity";

const PREVIEW_SELECTOR = [
  '[data-testid*="hero-preview" i]',
  '[data-testid*="trailer-preview" i]',
  '[data-testid="hero-video-player"]',
  '[data-uia="billboard-video"]',
  ".DynamicItemVideo__Block",
  ".previewModal--player-container",
  ".billboard-motion",
].join(",");
const PLAYER_SHELL = [
  "#dv-web-player",
  ".webPlayerSDKContainer",
  ".atvwebplayersdk-player-container",
  '[data-testid="web-player"]',
  '[data-testid="full-player"]',
  '[data-testid="video-player-modal"]',
  '[role="dialog"]',
  '[aria-modal="true"]',
].join(",");
const SEEK_CONTROL = [
  '[role="slider"][aria-label*="seek" i]',
  '[role="slider"][aria-label*="progress" i]',
  '[role="slider"][aria-label*="timeline" i]',
  '[role="slider"][aria-label*="재생 위치"]',
  '[aria-label="Seek"]',
  '[data-testid="seekbar"]',
  '[data-testid="scrubber"]',
  '[data-uia="seek-bar"]',
  ".atvwebplayersdk-seekbar-container",
].join(",");

function playbackRoute(value: string): boolean {
  const provider = detectProvider(value);
  if (!provider) return false;
  const url = new URL(value);
  switch (provider) {
    case "wavve":
      return (
        /^\/player\/(?:vod|movie)(?:\.html)?\/?$/.test(url.pathname) &&
        ["contentid", "movieid", "programid"].some(
          (key) => !!url.searchParams.get(key),
        )
      );
    case "laftel":
      return /^\/player\/\d+(?:\/\d+)?\/?$/.test(url.pathname);
    case "netflix":
      return /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?watch\/\d+\/?$/i.test(
        url.pathname,
      );
    case "crunchyroll":
      return /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?watch\/[a-z\d]+(?:\/[^/]*)?\/?$/i.test(
        url.pathname,
      );
    default:
      return false;
  }
}

function visibleVideo(video: HTMLVideoElement): boolean {
  const rect = video.getBoundingClientRect();
  if (
    rect.width < 240 ||
    rect.height < 135 ||
    video.closest('[hidden], [aria-hidden="true"]')
  )
    return false;
  let node: Element | null = video;
  while (node) {
    if (
      /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(
        node.getAttribute("style") ?? "",
      )
    )
      return false;
    const view = node.ownerDocument.defaultView;
    if (view && typeof view.getComputedStyle === "function") {
      const style = view.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden")
        return false;
    }
    node = node.parentElement;
  }
  return true;
}

function hasMainPlayerContext(video: HTMLVideoElement): boolean {
  if (video.closest(PREVIEW_SELECTOR)) return false;
  const shell = video.closest(PLAYER_SHELL);
  if (!shell) return false;
  // A shared SDK container or the word "player" alone is not main playback evidence:
  // Prime and Netflix also use player containers for automatic title previews.
  const label = shell.getAttribute("aria-label")?.trim() ?? "";
  const labelledPlayer =
    /^(?:(?:prime\s*video|netflix)\s+)?(?:video player|media player|동영상 플레이어|비디오 플레이어|작품 재생)$/i.test(
      label,
    );
  return (
    labelledPlayer ||
    shell.getAttribute("data-testid") === "full-player" ||
    !!shell.querySelector(SEEK_CONTROL)
  );
}

/** Keep the sidebar during automatic hero trailers; hide only for actual viewing. */
export function isPlaying(document: Document, pageUrl = document.URL): boolean {
  if (document.fullscreenElement || document.pictureInPictureElement)
    return true;
  const dedicatedPlayer = playbackRoute(pageUrl);
  return [...document.querySelectorAll("video")].some((video) => {
    if (
      video.paused ||
      video.ended ||
      video.readyState < 2 ||
      !visibleVideo(video)
    )
      return false;
    return (
      video.controls ||
      video.hasAttribute("controls") ||
      dedicatedPlayer ||
      hasMainPlayerContext(video)
    );
  });
}
