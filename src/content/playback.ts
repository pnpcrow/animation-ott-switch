/** Hide during visible playback, including muted playback and fullscreen players. */
export function isPlaying(document: Document): boolean {
  if (document.fullscreenElement || document.pictureInPictureElement)
    return true;
  return [...document.querySelectorAll("video")].some((video) => {
    if (video.paused || video.ended || video.readyState < 2) return false;
    const rect = video.getBoundingClientRect();
    const visible =
      rect.width >= 240 &&
      rect.height >= 135 &&
      getComputedStyle(video).visibility !== "hidden";
    return visible;
  });
}
