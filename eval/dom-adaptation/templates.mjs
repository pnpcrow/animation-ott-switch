// NLI receives a premise and a declarative hypothesis, not chat instructions.
// This is a representation ablation over the same observed candidate facts.
import { featurePack } from "../tiny-decision/v2/features.mjs";

export const templates = ["en-natural", "en-anchored", "en-contrast", "ko-natural"];
export const textTiers = [96, 64, 32];
export const maxTokens = 384;

const quote = value => JSON.stringify(value);
const elementNames = {
  h1: "level 1 heading", h2: "level 2 heading", h3: "level 3 heading",
  img: "image", meta: "metadata", title: "document title", p: "paragraph",
  a: "link", button: "button", nav: "navigation", main: "main region",
};
const name = tag => elementNames[tag] || tag;
const hypotheses = {
  "en-natural": {
    title: "This element gives the clean title of the series or movie currently open.",
    image: "This element supplies the representative poster or backdrop of the series or movie currently open.",
    description: "This element describes the story of the series or movie currently open.",
  },
  "en-contrast": {
    title: "This element names the movie or series shown in the current detail view, rather than an episode, another recommended work, or the streaming service.",
    image: "This element provides artwork representing the movie or series shown in the current detail view, rather than a text logo, service icon, episode thumbnail, or another work.",
    description: "This element gives the plot synopsis of the movie or series shown in the current detail view, rather than an episode summary, service advertisement, navigation, or legal text.",
  },
  "ko-natural": {
    title: "이 요소는 현재 상세 화면에 열린 영화 또는 시리즈의 작품 제목이다.",
    image: "이 요소는 현재 상세 화면에 열린 영화 또는 시리즈의 대표 포스터 또는 배경 이미지이다.",
    description: "이 요소는 현재 상세 화면에 열린 영화 또는 시리즈의 전체 줄거리와 이야기를 설명한다.",
  },
};

export function naturalPassage(page, candidate, language = "en") {
  const c = candidate;
  if (c.none) throw new Error("None is a decision outcome, not an observed DOM node");
  if (language === "ko") {
    return [
      `문서 제목은 ${quote(page.title)}이다. 경로는 ${quote(page.url)}이다.`,
      `보이는 제목 요소의 텍스트는 ${quote(page.headings)}이다. 보이는 대화상자 수는 ${page.dialogs ?? "미확인"}이다.`,
      `관측 요소의 태그는 ${quote(c.tag)}이고 ${quote(c.source)} 값은 ${quote(c.value)}이다.`,
      c.tag === "meta" || c.tag === "title" ? "문서 head의 메타데이터이다." : c.hidden ? "화면에서 숨겨져 있다." : "화면에 표시된다.",
      `부모 태그는 요소에서 바깥쪽 순서로 ${quote(c.parents)}이다.`,
      c.role ? `ARIA 역할은 ${quote(c.role)}이다.` : "",
      c.navigation ? "내비게이션 안에 있다." : "",
      c.inert ? "비활성 영역 안에 있다." : "",
      c.dialog ? `위치는 ${quote(c.dialog)} 안이다.` : "",
      c.alt ? `이미지 대체 텍스트는 ${quote(c.alt)}이다.` : "",
      c.width || c.height ? `${c.tag === "img" ? "이미지" : "요소"} 크기는 ${c.width ?? "미확인"} × ${c.height ?? "미확인"}이다.` : "",
      c.nearHeading ? `주변 제목은 ${quote(c.nearHeading)}이다.` : "",
      c.previous ? `직전 텍스트는 ${quote(c.previous)}이다.` : "",
      c.next ? `직후 텍스트는 ${quote(c.next)}이다.` : "",
    ].filter(Boolean).join(" ");
  }
  if (language !== "en") throw new Error("Unsupported language");
  return [
    `The document title is ${quote(page.title)}. The route is ${quote(page.url)}.`,
    `Visible headings read ${quote(page.headings)}. There are ${page.dialogs ?? "an unknown number of"} visible dialogs.`,
    `The observed ${name(c.tag)} element has ${quote(c.source)} value ${quote(c.value)}.`,
    c.tag === "meta" || c.tag === "title" ? "It is document head metadata." : c.hidden ? "It is hidden on the screen." : "It is visible on the screen.",
    `Its ancestors, nearest first, are ${quote(c.parents.map(name))}.`,
    c.role ? `Its ARIA role is ${quote(c.role)}.` : "",
    c.navigation ? "It is inside navigation." : "",
    c.inert ? "It is inside an inert region." : "",
    c.dialog ? `It is inside ${quote(c.dialog)}.` : "",
    c.alt ? `Its image alternative text is ${quote(c.alt)}.` : "",
    c.width || c.height ? `Its ${c.tag === "img" ? "image" : "element"} dimensions are ${c.width ?? "unknown"} by ${c.height ?? "unknown"}.` : "",
    c.nearHeading ? `The nearby heading reads ${quote(c.nearHeading)}.` : "",
    c.previous ? `The preceding text reads ${quote(c.previous)}.` : "",
    c.next ? `The following text reads ${quote(c.next)}.` : "",
  ].filter(Boolean).join(" ");
}

function anchoredHypothesis(field, candidate) {
  if (field === "title") return `${quote(candidate.value)} is the name of the movie or series currently open on this page.`;
  if (field === "image") return `The image described by ${quote(candidate.alt || candidate.value)} is the representative artwork of the movie or series currently open on this page.`;
  if (field === "description") return `The text ${quote(candidate.value)} describes the overall plot of the movie or series currently open on this page.`;
  throw new Error("Unsupported field");
}

export function pairsFor(row, template) {
  if (!templates.includes(template)) throw new Error("Unknown template");
  const packs = textTiers.map(textLimit => ({ textLimit, facts: featurePack(row, { textLimit }) }));
  return packs[0].facts.candidates.filter(c => !c.none).map(candidate => {
    const variants = packs.map(({ textLimit, facts }) => {
      const node = facts.candidates.find(c => c.id === candidate.id);
      const premise = naturalPassage(facts.page, node, template === "ko-natural" ? "ko" : "en");
      const hypothesis = template === "en-anchored" ? anchoredHypothesis(row.field, node) : hypotheses[template][row.field];
      return { textLimit, passage: premise, premise, hypothesis };
    });
    return {
      id: `${row.id}::${template}::${candidate.id}`, caseId: row.id,
      field: row.field, template, candidateId: candidate.id,
      ...variants[0], variants,
    };
  });
}

export function preparePairs(inputs, selected = templates) {
  if (new Set(inputs.map(r => r.id)).size !== inputs.length) throw new Error("Duplicate input case");
  if (!selected.length || new Set(selected).size !== selected.length || selected.some(t => !templates.includes(t))) throw new Error("Invalid template selection");
  return {
    schemaVersion: 1, maxTokens, textTiers, templates: selected,
    cases: selected.flatMap(template => inputs.map(row => ({
      id: row.id, field: row.field, split: row.split, template,
      optionIds: row.options.map(o => o.id),
      pairIds: pairsFor(row, template).map(p => p.id),
    }))),
    pairs: selected.flatMap(template => inputs.flatMap(row => pairsFor(row, template))),
  };
}
