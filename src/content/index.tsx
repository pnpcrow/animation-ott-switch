import { createRoot } from "react-dom/client";
import { extractPage } from "../providers/extract";
import { Overlay } from "./Overlay";
import { isPlaying } from "./playback";
import styles from "./styles.css";

const host = document.createElement("div");
host.id = "ott-switch-extension";
host.style.cssText =
  "all:initial;position:fixed;inset:0;width:0;height:0;z-index:2147483646;";
const shadow = host.attachShadow({ mode: "open" });
const style = document.createElement("style");
style.textContent = styles;
const container = document.createElement("div");
shadow.append(style, container);
const root = createRoot(container);
let lastKey = "";
let lastUrl = location.href;
let routeChangedAt = 0;
let stopped = false;
let timeout: ReturnType<typeof setTimeout> | undefined;
function refresh() {
  if (stopped) return;
  if (typeof chrome !== "undefined" && !chrome.runtime?.id) {
    stop();
    return;
  }
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    routeChangedAt = Date.now();
    root.render(null);
    lastKey = "";
  }
  if (Date.now() - routeChangedAt < 350) return;
  const page = extractPage(document, location.href);
  if (!page) {
    if (lastKey) root.render(null);
    lastKey = "";
    host.style.display = "none";
    return;
  }
  if (!host.isConnected) document.documentElement.append(host);
  host.style.display = isPlaying(document) ? "none" : "";
  const key = JSON.stringify(page);
  if (key !== lastKey) {
    lastKey = key;
    root.render(<Overlay key={page.url} page={page} />);
  }
}
function schedule() {
  if (timeout) clearTimeout(timeout);
  timeout = setTimeout(refresh, 200);
}
const observer = new MutationObserver((records) => {
  if (records.some((r) => !host.contains(r.target))) schedule();
});
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["content", "src", "poster"],
});
const interval = setInterval(refresh, 1200);
document.addEventListener("play", refresh, true);
document.addEventListener("pause", refresh, true);
document.addEventListener("ended", refresh, true);
document.addEventListener("fullscreenchange", refresh);
window.addEventListener("popstate", schedule);
function stop() {
  stopped = true;
  observer.disconnect();
  clearInterval(interval);
  clearTimeout(timeout);
  root.unmount();
  host.remove();
}
window.addEventListener("pagehide", (event) => {
  if (!event.persisted) stop();
});
refresh();
