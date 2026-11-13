import { describe, expect, it } from "vitest";
import { cleanTitle } from "../src/providers/identity";
import { matchCandidates } from "../src/providers/search";

describe("live cross-catalog title decorations", () => {
  it("treats prefix and suffix audio badges consistently without removing versions", () => {
    expect(cleanTitle("장송의 프리렌 (자막)")).toBe("장송의 프리렌");
    expect(cleanTitle("장송의 프리렌 (더빙)")).toBe("장송의 프리렌");
    expect(cleanTitle("장송의 프리렌(한국어더빙)")).toBe("장송의 프리렌");
    expect(cleanTitle("장송의 프리렌 2기 (더빙)")).toBe("장송의 프리렌 2기");
    expect(cleanTitle("Re: 제로부터 시작하는 이세계 생활 (감독판)")).toContain(
      "(감독판)",
    );
    expect(cleanTitle("약사의 혼잣말 총집편")).toContain("총집편");
  });
  it("keeps two matching sub/dub provider IDs ambiguous", () => {
    const page = {
      provider: "laftel" as const,
      url: "https://laftel.net/item/41666",
      title: "장송의 프리렌",
      aliases: [],
      description: "",
      imageUrl: "",
    };
    const found = matchCandidates("tving", page, [
      {
        title: "장송의 프리렌 (자막)",
        url: "https://www.tving.com/contents/P001747384",
      },
      {
        title: "장송의 프리렌 (더빙)",
        url: "https://www.tving.com/contents/P001760783",
      },
      {
        title: "장송의 프리렌 2기",
        url: "https://www.tving.com/contents/P001781702",
      },
    ]);
    expect(found.status).toBe("ambiguous");
    expect(found.candidates).toHaveLength(2);
  });
});
