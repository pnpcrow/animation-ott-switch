import { describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import {
  activateSearchAction,
  readSearchActions,
} from "../src/providers/search-actions";

const title = "어느 마녀가 죽을 때까지";
const url = `https://www.wavve.com/search?searchWord=${encodeURIComponent(title)}`;
const doc = (body: string) =>
  parseHTML(`<html><body><main>${body}</main></body></html>`)
    .document as unknown as Document;
const card = (name = title, attrs = "", image = "poster.jpg") =>
  `<a role="button" href="javascript:void(0)" aria-label="${name}" ${attrs}><img alt="${name}" src="https://image.wavve.com/${image}"><div aria-hidden="true">${name}</div></a>`;
const section = (heading: string, body = card()) =>
  `<section><h2>${heading}</h2>${body}</section>`;

describe("Wavve URL-less work cards", () => {
  it("accepts a real movie named Home when the poster and label agree", () => {
    expect(
      readSearchActions(doc(section("영화1", card("Home"))), "wavve", url)[0]
        .title,
    ).toBe("Home");
  });
  it("reads program/movie cards while excluding episodes and editor recommendations", () => {
    const document = doc(
      section("프로그램1") +
        section("에피소드12") +
        section("에디터Pick3") +
        section("The Witch List") +
        section("영화1", card("A Film")),
    );
    const results = readSearchActions(document, "wavve", url);
    expect(results.map((item) => item.title)).toEqual([title, "A Film"]);
    expect(readSearchActions(document, "wavve", url)).toEqual(results);
  });

  it("activates the one revalidated work card using its normal click event", () => {
    const document = doc(section("프로그램1"));
    const clicked = vi.fn();
    document.querySelector("a")!.addEventListener("click", clicked);
    const action = readSearchActions(document, "wavve", url)[0];
    expect(clicked).not.toHaveBeenCalled();
    expect(activateSearchAction(document, "wavve", url, action)).toBe(true);
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it.each([
    "https://www.wavve.com/player/vod?programid=CF02_CF0000000119",
    "https://www.wavve.com/search",
    "https://www.wavve.com.evil.test/search?searchWord=A",
  ])(
    "never discovers or activates outside an official nonempty search: %s",
    (pageUrl) => {
      const document = doc(section("프로그램1"));
      const action = readSearchActions(document, "wavve", url)[0];
      expect(readSearchActions(document, "wavve", pageUrl)).toEqual([]);
      expect(activateSearchAction(document, "wavve", pageUrl, action)).toBe(
        false,
      );
      expect(readSearchActions(document, "netflix", url)).toEqual([]);
    },
  );

  it("ignores hidden, disabled, and unrelated section cards", () => {
    const document = doc(
      section(
        "프로그램6",
        card(title, "hidden") +
          card(title, 'aria-disabled="true"') +
          card(title, 'style="display:none"') +
          `<div aria-hidden="true">${card()}</div>` +
          `<footer>${card()}</footer>` +
          `<div style="visibility:hidden">${card()}</div>`,
      ),
    );
    expect(readSearchActions(document, "wavve", url)).toEqual([]);
  });

  it("refuses title or poster changes between discovery and activation", () => {
    for (const mutation of [
      (document: Document) =>
        document
          .querySelector("a")!
          .setAttribute("aria-label", "Different Work"),
      (document: Document) =>
        document
          .querySelector("img")!
          .setAttribute("src", "https://image.wavve.com/different.jpg"),
      (document: Document) => {
        document.querySelector("a")!.remove();
      },
    ]) {
      const document = doc(section("프로그램1"));
      const action = readSearchActions(document, "wavve", url)[0];
      const clicked = vi.fn();
      document.querySelector("a")!.addEventListener("click", clicked);
      mutation(document);
      expect(activateSearchAction(document, "wavve", url, action)).toBe(false);
      expect(clicked).not.toHaveBeenCalled();
    }
  });

  it("refuses stale search queries, forged titles, and executable javascript hrefs", () => {
    const document = doc(section("프로그램1"));
    const action = readSearchActions(document, "wavve", url)[0];
    const clicked = vi.fn();
    document.querySelector("a")!.addEventListener("click", clicked);
    expect(
      activateSearchAction(document, "wavve", url + "changed", action),
    ).toBe(false);
    expect(
      activateSearchAction(document, "wavve", url, {
        ...action,
        title: "Different Work",
      }),
    ).toBe(false);
    document
      .querySelector("a")!
      .setAttribute("href", "javascript:alert('do not run')");
    expect(readSearchActions(document, "wavve", url)).toEqual([]);
    expect(activateSearchAction(document, "wavve", url, action)).toBe(false);
    expect(clicked).not.toHaveBeenCalled();
  });

  it("keeps identical-title cards distinct so the caller can refuse ambiguity", () => {
    const document = doc(
      section("프로그램2", card() + card(title, "", "dub.jpg")),
    );
    const results = readSearchActions(document, "wavve", url);
    expect(results).toHaveLength(2);
    expect(results[0].key).not.toBe(results[1].key);
  });

  it("does not borrow a program heading or card from an editor collection", () => {
    const document = doc(
      `<section><h2>에디터Pick1</h2>${card()}${section("프로그램1")}</section>`,
    );
    expect(readSearchActions(document, "wavve", url)).toHaveLength(0);
  });
});
