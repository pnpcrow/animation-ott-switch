import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { shuffleOptions } from "./dataset.mjs";

// Fictional fixtures authored before evaluating them. Never mix with real-DOM accuracy.
const specifications = [
  [
    "active-dialog-title",
    "title",
    "active-dialog-hidden-old-main",
    "Same URL. The active dialog is open. A previous detail remains hidden in main.",
    "Choose the current work title element, not a background work or service brand.",
    [
      "main[hidden]>h1 text=유리숲의 지도사",
      "dialog[open][aria-modal=true]>h1 text=별가루 수선공",
      "nav>h1 text=MoonScreen",
    ],
    "n2",
  ],
  [
    "stale-watch-metadata",
    "title",
    "watch-prefix-stale-brand-metadata",
    "SPA navigation completed. Document title and OG title were not refreshed; current main is visible.",
    "Choose the element containing the clean current series title, excluding service marketing and Watch-prefixed metadata.",
    [
      "head>title text=Watch Popular Stories, Play Games & Shop Online",
      "main>h1 text=은빛 우편함의 마녀",
      "head>meta[og:title] content=Watch 유리숲의 지도사 | MoonScreen",
    ],
    "n2",
  ],
  [
    "episode-versus-series",
    "title",
    "episode-heading-series-logo",
    "Current series detail includes episode 7 and a series title logo. Both are visible in main.",
    "Choose the series title element rather than the currently selected episode title.",
    [
      "main>section[episodes]>h1 text=7화: 마지막 열쇠",
      "main>header>h1>img alt=달빛 철도의 수습 기사 src=https://img.example/title.png",
      "head>title text=Watch 달빛 철도의 수습 기사 7화",
    ],
    "n2",
  ],
  [
    "preview-replaced-poster",
    "image",
    "preview-video-dom-replacement",
    "Same URL and work. Preview started: old img is disconnected; a connected video now supplies its poster attribute.",
    "Choose a representative image URL from the currently connected work panel. Exclude detached nodes and title logos.",
    [
      "img connected=false src=https://img.example/old-poster.jpg",
      "main>video connected=true poster=https://img.example/series-poster.jpg",
      "main>h1>img connected=true alt=별가루 수선공 src=https://img.example/title-logo.png",
    ],
    "n2",
  ],
  [
    "recommendation-description",
    "description",
    "recommendation-plot-versus-main-plot",
    "Open dialog heading: 은빛 우편함의 마녀. Related cards are in an aside outside that dialog.",
    "Choose the current series synopsis, not a recommendation or service description.",
    [
      "aside>article>h2 text=달빛 철도의 수습 기사; p=신입 기사가 달의 역을 순회하며 잃어버린 승객들을 찾는다.",
      "dialog[open]>h1 text=은빛 우편함의 마녀; next p=배달되지 않은 편지를 모으는 마녀가 마지막 수신인을 찾아 나선다.",
      "footer>p text=지금 가입하고 매주 새로운 작품을 만나세요.",
    ],
    "n2",
  ],
  [
    "search-season-match",
    "search-match",
    "exact-title-season-medium-match",
    "Target from source: title=별가루 수선공; season=1; medium=animation-series; year=2024. These are search result cards.",
    "Choose the candidate for the same work and season. A matching title alone is insufficient when season or medium differs.",
    [
      "a href=/work/302 title=별가루 수선공 season=2 medium=animation-series year=2026",
      "a href=/work/301 title=별가루 수선공 season=1 medium=animation-series year=2024",
      "a href=/work/401 title=별가루 수선공 season=1 medium=live-action-series year=2024",
    ],
    "n2",
  ],
  [
    "search-ambiguous-title",
    "search-match",
    "insufficient-identity-evidence",
    "Target: title=은빛 우편함. Source has no year, medium, season or external identifier. Both exact-title results below are plausible.",
    "Choose a result only when evidence uniquely identifies the same work. Otherwise choose none.",
    [
      "a href=/work/501 title=은빛 우편함 medium=movie year=2021",
      "a href=/work/502 title=은빛 우편함 medium=series year=2021",
      "a href=/work/503 title=은빛 우편함의 귀환 medium=series year=2025",
    ],
    "__none__",
  ],
  [
    "missing-synopsis",
    "description",
    "placeholder-and-marketing-only",
    "Work detail heading: 별가루 수선공. No actual plot text is loaded; only the listed text nodes exist.",
    "Choose a real current-work synopsis. A placeholder, subscription message or copyright notice is not a synopsis.",
    [
      "main>section[description]>p text=줄거리를 준비 중입니다.",
      "main>aside>p text=지금 구독하면 광고 없이 감상할 수 있습니다.",
      "footer>p text=Copyright 2026 Fictional Screen. All rights reserved.",
    ],
    "__none__",
  ],
  [
    "stacked-dialog-title",
    "title",
    "foreground-dialog-versus-visible-inert-dialog",
    "Two dialogs overlap. The first stays rendered but is inert; the second is the active foreground modal.",
    "Choose the title in the active foreground work dialog.",
    [
      "dialog[open][inert]>h1 text=유리숲의 지도사",
      "dialog[open][aria-modal=true][data-layer=foreground]>h1 text=구름 등대의 야간지기",
      "main>h1 text=이번 주 인기 작품",
    ],
    "n2",
  ],
  [
    "search-observed-alias",
    "search-match",
    "explicit-bilingual-alias",
    "Source detail explicitly lists title=우주 정거장의 밤당번; alternateName=Night Shift at Orbital Station; season=1; medium=animation-series.",
    "Choose the matching work using the observed alias and season. Do not invent translations or merge seasons.",
    [
      "a href=/work/601 title=Night Shift at Orbital Station season=1 medium=animation-series",
      "a href=/work/602 title=Night Shift at Orbital Station season=2 medium=animation-series",
      "a href=/work/603 title=Night Shift season=1 medium=live-action-series",
    ],
    "n1",
  ],
  [
    "closed-modal-title",
    "title",
    "closed-modal-and-search-background",
    "The work dialog was closed. Current screen is search results; no work detail is open. The old dialog subtree still exists hidden.",
    "Choose the title of the currently open work detail, or none when no detail is open. Search-card titles are not an open detail.",
    [
      "dialog[hidden][open=false]>h1 text=별가루 수선공",
      "main[role=search]>article>h2 text=별가루 수선공",
      "main[role=search]>article>h2 text=은빛 우편함의 마녀",
    ],
    "__none__",
  ],
  [
    "accessible-full-synopsis",
    "description",
    "accessible-full-text-versus-clipped-text",
    "Current detail: 구름 등대의 야간지기. The visual paragraph is clipped; its child accessibility label contains the full same synopsis.",
    "Choose the complete available series synopsis rather than the shortened visible preview or an episode plot.",
    [
      "main>p text=구름 위 등대를 지키는 소년이... 더보기",
      "main>p>span aria-label=구름 위 등대를 지키는 소년이 길을 잃은 별들을 안내하며 사라진 아버지의 항로를 찾아간다.",
      "main>section[episodes]>article>p text=1화: 소년은 첫 근무일에 고장 난 등불을 발견하고 수리를 시작한다.",
    ],
    "n2",
  ],
];

export function buildChallenges() {
  return specifications.map(
    ([name, field, scenario, document, question, texts, expectedId]) => {
      const id = `synthetic-${name}`;
      return {
        id,
        split: "holdout",
        cohort: "synthetic-challenge",
        field,
        scenario: [scenario],
        document,
        question,
        options: shuffleOptions(
          [
            ...texts.map((text, i) => ({ id: `n${i + 1}`, text })),
            { id: "__none__", text: "None: missing or insufficient evidence." },
          ],
          id,
        ),
        expectedId,
        acceptedIds: [expectedId],
        independentSample: false,
        provenance: {
          kind: "synthetic-challenge",
          fictional: true,
          source: "challenge.mjs",
          annotationMethod:
            "Authored explicit fictional state and reference; no evaluated model predictions used",
          specificationSha256: createHash("sha256")
            .update(
              JSON.stringify({
                name,
                field,
                scenario,
                document,
                question,
                texts,
                expectedId,
              }),
            )
            .digest("hex"),
        },
      };
    },
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cases = buildChallenges();
  await writeFile(
    new URL("./data/synthetic-challenge.json", import.meta.url),
    JSON.stringify(cases, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      syntheticCases: cases.length,
      realSamples: 0,
      maxInputChars: Math.max(
        ...cases.map(
          (c) =>
            [c.document, c.question, ...c.options.map((o) => o.text)].join("\n")
              .length,
        ),
      ),
    }),
  );
}
