import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { syncSearchInput } from "../src/providers/search-input";

const title = "수수께끼 풀이는 저녁식사 후에";
const url = `https://www.primevideo.com/search?phrase=${encodeURIComponent(title)}`;
const fixture = (attrs = "", form = 'action="/-/ko/search" method="get"') => {
  const document = parseHTML(
    `<html><body><form ${form}><input type="search" name="phrase" ${attrs}></form></body></html>`,
  ).document as unknown as Document;
  const input = document.querySelector("input")!;
  return { document, input };
};

describe("Prime URL query display", () => {
  it("fills the official visible GET search field and emits framework input events without submitting", () => {
    const { document, input } = fixture();
    const events: string[] = [];
    for (const type of ["input", "change", "submit", "focus"])
      document.addEventListener(type, () => events.push(type));
    expect(syncSearchInput(document, "prime", url)).toBe(true);
    expect(input.value).toBe(title);
    expect(events).toEqual(["input", "change"]);
    expect(syncSearchInput(document, "prime", url)).toBe(false);
  });

  it("does not overwrite user text or refill after the user clears a synchronized field", () => {
    const { document, input } = fixture();
    input.value = "사용자가 입력한 제목";
    expect(syncSearchInput(document, "prime", url)).toBe(false);
    expect(input.value).toBe("사용자가 입력한 제목");
    input.value = "";
    expect(syncSearchInput(document, "prime", url)).toBe(false);
    const next = fixture();
    syncSearchInput(next.document, "prime", url);
    next.input.value = "";
    expect(syncSearchInput(next.document, "prime", url)).toBe(false);
  });

  it("waits until the collapsed search field becomes visible", () => {
    const { document, input } = fixture('style="display:none"');
    expect(syncSearchInput(document, "prime", url)).toBe(false);
    input.removeAttribute("style");
    expect(syncSearchInput(document, "prime", url)).toBe(true);
  });

  it.each([
    ['action="https://evil.test/search"'],
    ['action="/login"'],
    ['action="/search" method="post"'],
  ])("does not modify an unrelated form: %s", (form) => {
    const { document, input } = fixture("", form);
    expect(syncSearchInput(document, "prime", url)).toBe(false);
    expect(input.value).toBe("");
  });

  it.each([
    "https://www.primevideo.com/search",
    "https://www.primevideo.com/detail/B012345678?phrase=test",
    "https://www.primevideo.com.evil.test/search?phrase=test",
  ])("ignores a non-search URL: %s", (value) => {
    const { document } = fixture();
    expect(syncSearchInput(document, "prime", value)).toBe(false);
  });

  it("does not touch other services and can synchronize a later empty SPA search", () => {
    const { document, input } = fixture();
    expect(syncSearchInput(document, "wavve", url)).toBe(false);
    syncSearchInput(document, "prime", url);
    input.value = "";
    const next = "https://www.primevideo.com/-/ko/search?phrase=Frieren";
    expect(syncSearchInput(document, "prime", next)).toBe(true);
    expect(input.value).toBe("Frieren");
  });
});
