import type { ProbeReply, ProbeRequest } from "../core/probe";
import { detectProvider } from "../providers/identity";
import { extractPage } from "../providers/extract";
import { readSearchResults } from "../providers/search-results";

// Only the extension service worker may ask an isolated content script to inspect this DOM.
export function installProbe(onProbe: () => void) {
  chrome.runtime.onMessage.addListener(
    (message: ProbeRequest, sender, reply) => {
      if (
        message?.channel !== "ott-switch-probe" ||
        sender.id !== chrome.runtime.id ||
        typeof message.token !== "string" ||
        message.token.length > 100 ||
        detectProvider(location.href) !== message.provider
      )
        return;
      onProbe();
      const state: ProbeReply = {
        token: message.token,
        url: location.href,
        ready: document.readyState === "complete",
      };
      if (message.kind === "search")
        Object.assign(
          state,
          readSearchResults(document, message.provider, location.href),
        );
      else if (message.kind === "detail")
        state.detail = extractPage(document, location.href);
      else return;
      reply(state);
    },
  );
}
