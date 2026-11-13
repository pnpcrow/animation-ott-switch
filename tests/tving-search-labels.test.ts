import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { readSearchResults } from "../src/providers/search-results";
import { matchCandidates } from "../src/providers/search";

const query = "https://www.tving.com/search?keyword=장송의%20프리렌";
const card = (id: string, title: string, badge = "") =>
  `<a href="/contents/${id}"><div class="basic-item-wrapper"><p class="atom-text-wrapper vertical-item-poster-text-center">${title}</p><img alt="${title} 포스터" src="https://image.tving.com/${id}.jpg"><div class="subtitle-label-wrapper"><span>${badge}</span></div></div></a>`;
describe("TVING observed poster labels", () => {
  it("uses the work paragraph instead of alt poster text or an appended subtitle badge", () => {
    const { document } = parseHTML(
      `<main>${card("P001747384", "장송의 프리렌 (자막)", "자막")}${card("P001760783", "장송의 프리렌 (더빙)", "더빙")}${card("P001781702", "장송의 프리렌 2기")}</main>`,
    );
    const result = readSearchResults(document, "tving", query);
    expect(result.candidates.map((c) => c.title)).toEqual([
      "장송의 프리렌",
      "장송의 프리렌",
      "장송의 프리렌 2기",
    ]);
    const match = matchCandidates(
      "tving",
      {
        provider: "laftel",
        url: "https://laftel.net/item/41666",
        title: "장송의 프리렌",
        aliases: [],
        description: "",
        imageUrl: "",
      },
      result.candidates,
    );
    expect(match.status).toBe("ambiguous");
    expect(match.candidates).toHaveLength(2);
  });
  it("preserves 포스터 when it is part of the actual work label", () => {
    const { document } = parseHTML(
      `<main>${card("M000123456", "마지막 포스터")}</main>`,
    );
    expect(
      readSearchResults(document, "tving", query).candidates[0]?.title,
    ).toBe("마지막 포스터");
  });
});
