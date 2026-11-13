import { describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import {
  activateSearchAction,
  readSearchActions,
} from "../src/providers/search-actions";

const title = "장송의 프리렌";
const url = `https://www.aniplustv.com/Search?st=${encodeURIComponent(title)}`;
const card = (name = title, attrs = "", image = "poster.jpg") =>
  `<div class="div_li" ${attrs}><div class="list_img_bg" style="cursor:pointer"><img src="https://cdn.example.org/${image}"></div><p>${name} <span>판타지</span></p></div>`;
const group = (body = card(), query = title) =>
  `<div class="vod_list_group"><h1><em>"${query}"</em>에 대한 검색 결과 <span>(1)</span></h1><div class="vod_vod_list">${body}</div></div>`;
const doc = (body = group()) =>
  parseHTML(`<html><body>${body}</body></html>`)
    .document as unknown as Document;

describe("Aniplus URL-less search result cards", () => {
  it("reads visible work labels without their nested genre badges", () => {
    const actions = readSearchActions(
      doc(group(card() + card(title + " 2기") + card(title + "(한국어더빙)"))),
      "aniplus",
      url,
    );
    expect(actions.map((action) => action.title)).toEqual([
      title,
      title + " 2기",
      title,
    ]);
  });
  it("uses only the normal image-card click after revalidating its snapshot", () => {
    const document = doc();
    const clicked = vi.fn();
    document.querySelector(".list_img_bg")!.addEventListener("click", clicked);
    const action = readSearchActions(document, "aniplus", url)[0];
    expect(clicked).not.toHaveBeenCalled();
    expect(activateSearchAction(document, "aniplus", url, action)).toBe(true);
    expect(clicked).toHaveBeenCalledTimes(1);
  });
  it.each([
    "https://www.aniplustv.com/items/3011",
    "https://www.aniplustv.com/Search",
    "https://www.aniplustv.com.evil.test/Search?st=A",
  ])("rejects a non-search, empty or foreign route: %s", (pageUrl) => {
    expect(readSearchActions(doc(), "aniplus", pageUrl)).toEqual([]);
  });
  it("does not use stale query headings or similar cards outside search results", () => {
    expect(
      readSearchActions(doc(group(card(), "던전밥")), "aniplus", url),
    ).toEqual([]);
    expect(readSearchActions(doc(card()), "aniplus", url)).toEqual([]);
    expect(
      readSearchActions(
        doc(group().replace("검색 결과", "추천 작품")),
        "aniplus",
        url,
      ),
    ).toEqual([]);
    expect(readSearchActions(doc(), "wavve", url)).toEqual([]);
  });
  it("rejects hidden, disabled and recommended collections", () => {
    const document = doc(
      group(
        card(title, "hidden") +
          card(title, 'aria-disabled="true"') +
          card(title, 'style="display:none"'),
      ) +
        `<footer>${group()}</footer>` +
        `<div aria-label="추천">${group()}</div>`,
    );
    expect(readSearchActions(document, "aniplus", url)).toEqual([]);
  });
  it("rejects changed titles, images and query strings before click", () => {
    for (const mutate of [
      (document: Document) => {
        document.querySelector("p")!.firstChild!.textContent = "던전밥";
      },
      (document: Document) => {
        document
          .querySelector("img")!
          .setAttribute("src", "https://cdn.example.org/changed.jpg");
      },
      (document: Document) => {
        document.querySelector("em")!.textContent = '"던전밥"';
      },
    ]) {
      const document = doc();
      const action = readSearchActions(document, "aniplus", url)[0];
      const clicked = vi.fn();
      document
        .querySelector(".list_img_bg")!
        .addEventListener("click", clicked);
      mutate(document);
      expect(activateSearchAction(document, "aniplus", url, action)).toBe(
        false,
      );
      expect(clicked).not.toHaveBeenCalled();
    }
    const document = doc();
    expect(
      activateSearchAction(
        document,
        "aniplus",
        url + "changed",
        readSearchActions(document, "aniplus", url)[0],
      ),
    ).toBe(false);
  });
  it("keeps duplicate title cards separate so resolution can refuse ambiguity", () => {
    const actions = readSearchActions(
      doc(group(card() + card(title, "", "dub.jpg"))),
      "aniplus",
      url,
    );
    expect(actions).toHaveLength(2);
    expect(actions[0].key).not.toBe(actions[1].key);
  });
});
