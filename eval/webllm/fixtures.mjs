// Authored regression fixtures, not current catalog or subscription assertions.
// Detail URLs are deliberately synthetic valid-shape IDs. Live observations belong in
// separately imported datasets with dated provenance and independently reviewed labels.
const make = (id, split, title, options = {}) => {
  const metadata = options.metadata !== false;
  return {
    id,
    split,
    provenance:
      "Authored synthetic regression fixture. URLs are test identifiers, not evidence of current service availability.",
    input: {
      provider: "netflix",
      query: {
        title,
        aliases: options.aliases || [],
        kind: "series",
        version: options.version || "",
        year: null,
      },
      complete: options.complete ?? true,
      evidence: metadata
        ? [
            {
              id: "branding",
              kind: "title",
              value: "Netflix - TV Shows and Movies Online",
              role: "document-title",
              scope: "site",
            },
            {
              id: "work",
              kind: "title",
              value: title,
              role: "h1",
              scope: "main-work",
            },
            {
              id: "poster",
              kind: "image",
              value: "https://example.com/observed-poster.jpg",
              role: "poster",
              scope: "main-work",
            },
            {
              id: "synopsis",
              kind: "description",
              value: "주인공의 새로운 모험이 시작된다.",
              role: "synopsis",
              scope: "main-work",
            },
          ]
        : [],
      candidates: options.candidates || [
        {
          id: "a",
          title,
          url: "https://www.netflix.com/title/99990001",
          aliases: [],
          kind: "series",
          version: "",
          year: null,
        },
      ],
    },
    expected: {
      titleId: metadata ? "work" : "",
      imageId: metadata ? "poster" : "",
      descriptionId: metadata ? "synopsis" : "",
      candidateId: options.expectedId ?? "a",
      status: options.status || "match",
    },
  };
};
const candidate = (id, title, kind = "series", version = "") => ({
  id,
  title,
  url: `https://www.netflix.com/title/9999000${id === "a" ? 1 : 2}`,
  aliases: [],
  kind,
  version,
  year: null,
});
export const starterDataset = {
  schemaVersion: 1,
  name: "작성된 회귀 사례 · 실제 서비스 제공 여부 자료가 아닙니다",
  cases: [
    make("witch-metadata", "calibration", "어느 마녀가 죽을 때까지"),
    make("frieren-duplicate", "calibration", "장송의 프리렌", {
      candidates: [
        candidate("a", "장송의 프리렌 (자막)", "series", "subtitled"),
        candidate("b", "장송의 프리렌 (더빙)", "series", "dubbed"),
      ],
      expectedId: "",
      status: "ambiguous",
    }),
    make("sakura-alias", "calibration", "카드캡터 사쿠라", {
      aliases: ["카드캡터 체리"],
      candidates: [candidate("a", "카드캡터 체리")],
    }),
    make("apothecary-recap", "calibration", "약사의 혼잣말", {
      candidates: [
        candidate("a", "약사의 혼잣말", "series"),
        candidate("b", "약사의 혼잣말 총집편", "recap"),
      ],
    }),
    make("nia-unknown-subtitle", "holdout", "흉란영애 니아 리스톤", {
      candidates: [candidate("a", "흉란영애 니아 리스톤: 새 모험", "series")],
      complete: false,
      expectedId: "",
      status: "unknown",
    }),
    make("rezero-edition", "holdout", "Re: 제로부터 시작하는 이세계 생활", {
      version: "original",
      candidates: [
        candidate(
          "a",
          "Re: 제로부터 시작하는 이세계 생활",
          "series",
          "original",
        ),
        candidate(
          "b",
          "Re: 제로부터 시작하는 이세계 생활 신편집판",
          "series",
          "director-cut",
        ),
      ],
    }),
    make("dungeon-blocked", "holdout", "던전밥", {
      metadata: false,
      complete: false,
      candidates: [],
      expectedId: "",
      status: "unknown",
    }),
    make("dinner-adaptation", "holdout", "수수께끼 풀이는 저녁식사 후에", {
      version: "animation",
      candidates: [
        candidate("a", "수수께끼 풀이는 저녁식사 후에", "series", "animation"),
        candidate(
          "b",
          "수수께끼 풀이는 저녁식사 후에",
          "series",
          "live-action",
        ),
      ],
    }),
  ],
};
